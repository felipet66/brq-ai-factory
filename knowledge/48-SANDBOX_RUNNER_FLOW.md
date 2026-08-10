# Sandbox Runner Flow

## Purpose

The Sandbox Runner is the Sprint 23 boundary authorized to evaluate a materialized workspace. It
runs only fixed preparation, typecheck, build and test commands inside a disposable container. It
does not generate or materialize code, and it never executes generated code directly on the host.

## Architectural boundary

```mermaid
flowchart LR
    Generated["GeneratedCodeBundle: untrusted text"] --> Controlled["Controlled Workspace"]
    Controlled --> Materialized["WorkspaceMaterializationResult"]
    Materialized --> Request["SandboxRunRequest"]
    Policy["Trusted host policy"] --> Request
    Request --> Port["SandboxRunner port"]
    Port --> Docker["Explicit Docker adapter"]
    Docker --> Result["Immutable SandboxRunResult"]

    Port -. "No import" .-> Generator["Code Generator"]
    Port -. "No integration" .-> Workflow["Workflow / API / Repository / UI"]
```

`core/sandbox-runner` owns a provider-neutral contract. Docker is an explicit adapter and does not
leak into the public port. A caller chooses a trusted `policyId`; the request cannot choose image,
commands, environment, mounts or network.

## Complete run sequence

```mermaid
sequenceDiagram
    participant C as Trusted caller
    participant R as SandboxRunner
    participant W as Workspace verifier
    participant D as Docker adapter
    participant H as Pinned container helper

    C->>R: run(request, optional AbortSignal)
    R->>R: validate request, policy and reduced limits
    R->>W: reread declared workspace
    W->>W: verify root, entries, bytes and hashes
    W-->>R: bounded canonical envelope
    R->>D: inspect digest-pinned local image
    D->>D: create isolated container
    D->>D: inspect effective security configuration
    D->>H: start idle container
    D->>H: run fixed readiness helper from root
    H->>H: create and verify tmpfs directories
    D->>H: PREPARE streams envelope through stdin
    H->>H: reconstruct and verify disposable copy
    loop PREPARE, TYPECHECK, BUILD, TEST
        R->>D: exec fixed executable + argument vector
        D-->>R: bounded stdout/stderr + exit/resource outcome
    end
    R->>D: remove container and anonymous volumes
    D-->>R: cleanup confirmed
    R-->>C: terminal immutable SandboxRunResult
```

The original workspace is never mounted. The copy transferred through stdin is bounded by the
existing Controlled Workspace limits and verified on both sides of the trust transition.

## Run state machine

```mermaid
stateDiagram-v2
    [*] --> PENDING
    PENDING --> RUNNING
    RUNNING --> SUCCESS: all steps and cleanup succeed
    RUNNING --> FAILED: validation, runtime or step failure
    RUNNING --> TIMEOUT: step or global deadline
    RUNNING --> CANCELLED: AbortSignal
    SUCCESS --> [*]
    FAILED --> [*]
    TIMEOUT --> [*]
    CANCELLED --> [*]
```

There is no retry, resume or correction transition. A cleanup failure prevents `SUCCESS` and is
represented as a canonical infrastructure failure.

## Fixed step pipeline

```mermaid
flowchart LR
    Prepare["PREPARE<br/>validate helper, metadata and dependency snapshot"] --> Typecheck["TYPECHECK<br/>fixed trusted command"]
    Typecheck --> Build["BUILD<br/>fixed trusted command"]
    Build --> Test["TEST<br/>fixed trusted command"]
    Test --> Complete["Terminal result"]

    Prepare -- "Failure / timeout / cancel" --> Stop["Stop and mark later steps SKIPPED"]
    Typecheck -- "Failure / timeout / cancel" --> Stop
    Build -- "Failure / timeout / cancel" --> Stop
    Test -- "Failure / timeout / cancel" --> Stop
    Stop --> Cleanup["Exactly-once cleanup"]
    Complete --> Cleanup
```

Only one step can be `RUNNING`. Later steps become `SKIPPED` after the first terminal interruption.

## Command authority

```mermaid
flowchart TD
    Policy["Versioned host policy"] --> Executable["Absolute executable in pinned image"]
    Policy --> Args["Fixed argument vector"]
    Policy --> Env["Minimal allowlisted environment"]
    Executable --> Exec["docker exec without shell"]
    Args --> Exec
    Env --> Exec

    Model["AI output"] -. "Rejected as command source" .-> Exec
    Package["package.json scripts"] -. "Never invoked" .-> Exec
    Request["SandboxRunRequest"] -. "Cannot supply command or environment" .-> Exec
```

The runner never invokes `npm run`, `npm test`, shell pipelines or dependency lifecycle scripts.
Package metadata is validation input only.

## Container lifecycle

```mermaid
flowchart TD
    Validate["Validate request + trusted policy"] --> Image["Verify local digest-pinned image"]
    Image --> Create["Create one isolated container"]
    Create --> Inspect["Inspect effective configuration"]
    Inspect --> Start["Start pinned helper"]
    Start --> Steps["Execute fixed step sequence"]
    Steps --> Remove["Remove container + anonymous volumes"]
    Remove --> Confirm{"Removal confirmed?"}
    Confirm -- "Yes" --> Finalize["Build terminal result"]
    Confirm -- "No" --> CleanupFailure["SANDBOX_CLEANUP_FAILED"]
    CleanupFailure --> Finalize
    Finalize --> Return["Return result"]
```

Image pull and image build are never implicit. A missing or mismatched image fails closed before
untrusted code runs.

## Filesystem isolation

```mermaid
flowchart LR
    Root["Host-controlled workspace root"] --> Verify["lstat + realpath + exact file enumeration"]
    Verify --> Rehash["Recalculate bytes and hashes"]
    Rehash --> Envelope["Canonical bounded envelope"]
    Envelope -->|"stdin only"| Helper["Pinned non-root helper"]
    Helper --> Copy["/workspace/project on bounded tmpfs"]
    Copy --> Reverify["Reverify paths, counts and hashes"]
    Reverify --> Execute["Fixed build/test steps"]

    Root -. "No bind mount" .-> Copy
    HostPath["Physical host path"] -. "Never exposed" .-> Helper
```

The image root is read-only. `/workspace` and `/tmp` are bounded tmpfs locations and are discarded
with the container. No build output is copied back.

## Isolation controls

```mermaid
flowchart TB
    Container["Disposable non-root container"]
    Container --> Network["network=none"]
    Container --> Privileges["cap-drop=ALL + no-new-privileges + seccomp"]
    Container --> Filesystem["read-only root + bounded tmpfs"]
    Container --> Resources["CPU + memory + PIDs + open-files limits"]
    Container --> Exposure["no ports, mounts, devices or Docker socket"]
    Container --> Identity["digest-pinned image + verified labels"]
```

Approved ceilings are 1 vCPU, 2 GiB memory without extra swap, 128 PIDs, 512 MiB workspace tmpfs,
128 MiB temporary tmpfs, 1,024 open files, 32,768 workspace inodes and 16,384 temporary inodes.

## Timeout, cancellation and cleanup

```mermaid
sequenceDiagram
    participant S as Caller signal / deadline
    participant R as Runner
    participant P as Active Docker CLI process
    participant C as Container
    participant X as Cleanup coordinator

    S-->>R: cancel or expire
    R->>P: terminate active control command
    R->>X: request cleanup once
    X->>C: remove --force --volumes
    X->>X: inspect absence with independent deadline
    X-->>R: confirmed or cleanup failure
    R-->>S: CANCELLED or TIMEOUT result
```

Removing the container, instead of only terminating `docker exec`, ensures descendants cannot
continue after cancellation. Success, failure, timeout and cancellation share the same idempotent
cleanup owner.

The public `timeoutMs` recorded for a step is its deterministic authorized ceiling. When the
remaining global deadline is lower, the Docker adapter applies that smaller operational allowance
without placing the elapsed-time-derived value in deterministic hashes.

## Output pipeline

```mermaid
flowchart LR
    Stream["Untrusted stdout / stderr"] --> Drain["Continuous bounded drain"]
    Drain --> Normalize["UTF-8 + line-ending normalization"]
    Normalize --> Sanitize["ANSI/control removal + secret/path redaction"]
    Sanitize --> Truncate["Deterministic head/tail summary"]
    Truncate --> Hash["Summary hashes + counts"]
    Hash --> Result["SandboxStepResult"]

    Drain --> Hard{"Hard output limit crossed?"}
    Hard -- "Yes" --> Stop["Remove container and return SANDBOX_OUTPUT_LIMIT"]
```

Diagnostic summaries are bounded. Structured lifecycle logs never include the summary text. Each
stream captures at most 256 KiB, 2,000 lines and 8 KiB per line; 4 MiB of combined raw output per
step is the hard termination ceiling.

## Hash and provenance chain

```mermaid
flowchart LR
    Technical["TechnicalSpecificationHash"] --> Bundle["GeneratedCodeBundleHash"]
    Bundle --> Plan["WorkspacePlanHash"]
    Plan --> Workspace["WorkspaceHash"]
    Workspace --> Request["SandboxRequestHash"]
    Policy["PolicyHash"] --> Request
    Request --> Result["SandboxResultHash"]

    Runtime["Image / runtime / toolchain / helper / limits"] --> Provenance["Sandbox provenance"]
    Result --> Lineage["Sandbox lineage"]
```

Timestamps, durations, container identity and physical paths are observational and stay outside
deterministic hashes. The policy hash explicitly binds the fixed step order and output sanitizer
version. Lineage and provenance remain separate.

## Test boundary

```mermaid
flowchart TD
    Unit["Normal quality gates"] --> Fake["Fake Docker executor"]
    Fake --> Contracts["Contracts, commands, lifecycle and security regressions"]

    Context["Versioned minimal image context"] --> Build["Explicit local build"]
    Build --> Real["Digest-pinned preloaded image"]
    OptIn["npm run test:sandbox:integration"] --> Explicit["Explicit local Docker prerequisites"]
    Explicit --> Real
    Real --> Assertions["Isolation, limits, cancellation and cleanup"]

    Unit -. "No daemon dependency" .-> OptIn
```

The opt-in suite performs no automatic pull or image build and is not part of `npm run test`,
coverage or the default quality gates. The versioned integration image uses fixed helpers to
validate the envelope, typecheck with the pinned compiler, build without package scripts and run a
fixed assertion; image preparation remains a separate host operation.

## Future integration boundary

```mermaid
flowchart LR
    Workspace["Controlled Workspace"] --> Approval["Future trusted application policy"]
    Approval --> Runner["Sandbox Runner"]
    Runner --> FutureEvents["Future execution events"]
    FutureEvents --> FutureReadModel["Future API / Factory projection"]

    Runner -. "Sprint 23 does not connect" .-> Workflow["Current workflow"]
    Runner -. "Sprint 23 does not expose" .-> Preview["Preview Runner"]
```

A later Sprint must explicitly define ownership, persistence, events and authorization before the
runner becomes part of an execution. A successful build does not start a server, expose a port,
retain the container, export artifacts or produce a preview.
