# ADR-033 — Sandbox Build and Test Runner Boundary

## Status

Accepted

## Date

2026-08-09

## Context

ADR-032 separates textual code generation from controlled filesystem materialization. A
`GeneratedCodeBundle` can become a verified local workspace, but that workspace remains untrusted
data. Neither Code Generator nor Controlled Workspace is authorized to install dependencies,
compile, test or execute it.

Sprint 23 must determine whether a materialized workspace passes a fixed preparation, typecheck,
build and test pipeline. Granting the AI Factory process direct execution authority would collapse
the trust boundary established by ADR-032. Accepting commands, package scripts, image names,
mounts, environment or network configuration from model output would create the same problem in a
different component.

Docker provides a replaceable isolation mechanism, but it is not itself the domain contract and it
is not a perfect security boundary against a compromised daemon, kernel vulnerability or container
escape. The core contract therefore needs to remain provider-neutral while the concrete adapter
applies a defense-in-depth policy to one disposable container.

## Decision

Create `core/sandbox-runner` as a provider-neutral port for explicit build and test runs. Expose the
Docker implementation only through an explicit adapter subpath. The main entrypoint contains
contracts, strict schemas, policies, immutable results, lifecycle semantics, errors and
deterministic hashing without importing Docker-specific types.

The three authorities remain independent:

```text
generate textual code != materialize a controlled workspace != execute inside a sandbox
```

The runner receives only the public result of Controlled Workspace plus trusted correlation and a
host-selected policy. It never imports Code Generator, agents, Orchestrator, Execution Engine,
Worker, Queue, Repository, Prisma or applications.

Sprint 23 does not connect the runner to workflow, API, Repository, Observability, Factory View or
Preview. A trusted caller must invoke it explicitly. No existing execution acquires a build or test
stage as a consequence of this decision.

## Provider-neutral port

The public port accepts a strict `SandboxRunRequest` and an optional out-of-band `AbortSignal`, then
returns one terminal, deeply immutable `SandboxRunResult`. `AbortSignal` is never serialized,
persisted, logged or hashed.

The request may identify:

- technical correlation;
- the public materialization result;
- a trusted `policyId`;
- optional reductions of approved resource ceilings.

It cannot provide:

- a host path;
- image, command, argument or shell text;
- environment variables;
- mounts, devices, ports or Docker flags;
- package-manager or package-script selection;
- network policy.

The host policy is authoritative. Request overrides can only reduce, never raise, CPU, memory,
PIDs, writable space, timeout or output ceilings.

## Execution lifecycle

One run owns one disposable container and follows the fixed pipeline:

```text
PREPARE -> TYPECHECK -> BUILD -> TEST
```

Only one step may be `RUNNING`. A failed, timed-out or cancelled step terminates the pipeline
immediately and all later steps become `SKIPPED`. There is no retry, resume, correction, fallback
command or alternate package manager.

The run state is:

```text
PENDING -> RUNNING -> SUCCESS | FAILED | TIMEOUT | CANCELLED
```

`SUCCESS` requires every step to succeed and container cleanup to be confirmed. An infrastructure
or cleanup failure cannot be reported as a successful code run.

## Trusted command policy

The host selects an immutable, versioned execution policy. Every step uses an absolute executable
inside the pinned image, a fixed argument vector, a fixed working directory and an allowlisted
environment. The Docker CLI is invoked with `shell: false`; no command string is evaluated by a
shell.

Commands or arguments from model output, source files, `package.json`, lockfiles or the request are
never executed. In particular, the runner never invokes `npm run`, `npm test`, Yarn scripts, pnpm
scripts or dependency lifecycle hooks such as `preinstall`, `install`, `postinstall`, `prepare`,
`prebuild`, `postbuild`, `pretest` or `posttest`.

The initial policies support only a no-dependency Node 24 profile and an explicitly approved npm
snapshot profile. Package metadata and lockfiles are validation input, not execution authority.
Dependencies must already exist in the pinned image or its approved read-only snapshot. Missing or
incompatible dependencies fail closed; the adapter never falls back to an online registry.

## Docker adapter

The Docker adapter is a control-plane implementation of the port. It may start the trusted Docker
CLI with fixed arguments, but it never starts generated code directly on the host. The adapter:

1. validates the request, policy and effective limits;
2. re-reads and re-hashes the controlled workspace;
3. verifies that a digest-pinned image already exists locally and matches expected identity,
   platform, labels, helper ABI and dependency snapshot;
4. creates one container with the complete security policy;
5. inspects the effective container configuration before start;
6. starts the idle container and runs a fixed readiness helper that creates and verifies only the
   tmpfs-backed working directories;
7. transfers a bounded canonical workspace envelope through stdin;
8. runs the four fixed steps in order;
9. collects bounded, sanitized diagnostics and resource outcomes;
10. removes the container and anonymous volumes exactly once;
11. confirms cleanup before resolving the run.

The adapter uses `--pull=never`. Tags without a digest, image pull, image build and mutable image
selection are prohibited.

The readiness handshake is an adapter setup operation, not a fifth public lifecycle stage. It
removes scheduling races between container start and `PREPARE` without retry, synthetic delay or
generated commands. Its implementation is bound by the verified image digest and helper ABI.

## Container isolation policy

The container runs with:

- no network;
- no IPC sharing;
- a private cgroup namespace;
- a read-only root filesystem;
- fixed non-root UID/GID `65532:65532`;
- all Linux capabilities dropped;
- `no-new-privileges` and the built-in seccomp profile;
- no privileged mode, devices, host namespaces, ports or restart policy;
- no bind mount, host volume or Docker socket;
- bounded CPU, memory, PIDs, open files and writable tmpfs;
- a fixed, minimal environment with no inherited host secrets.

Approved ceilings are 1 vCPU, 2 GiB of memory with no additional swap, 128 PIDs, 512 MiB for
`/workspace`, 128 MiB for `/tmp`, 1,024 open files, 32,768 workspace inodes and 16,384 temporary
inodes. The Node heap is limited below the container memory ceiling. A run cannot raise these
values.

The default total deadline is 300 seconds. Step ceilings are 30 seconds for `PREPARE`, 90 seconds
for `TYPECHECK`, 120 seconds for `BUILD` and 90 seconds for `TEST`; the remaining global deadline
always wins.

## Filesystem and integrity boundary

The original host workspace is never mounted in the container. The adapter resolves the workspace
only beneath the host-controlled root, rejects symlinks and unexpected entries, enumerates exactly
the declared files and recalculates byte counts and hashes. A bounded canonical envelope is sent
through stdin to a pinned helper inside the container.

The helper reconstructs a disposable copy at `/workspace/project` and independently verifies
paths, counts and hashes. Any divergence produces an integrity failure before typecheck, build or
test. Host paths never enter the request, container arguments, logs, result, lineage or provenance.

The image root stays read-only. Only bounded tmpfs locations are writable and all writes disappear
with the container. The runner does not copy build artifacts back to the host.

## Output, secrets and logging

stdout and stderr are untrusted. Each stream is drained with byte and line ceilings, ANSI and
control removal, UTF-8-safe normalization, credential and host-path redaction, deterministic
head/tail truncation and a hard anti-abuse limit. Crossing the hard limit stops and removes the
container and returns `SANDBOX_OUTPUT_LIMIT`; output is never silently accepted after overflow.

Each stream captures at most 256 KiB, 2,000 lines and 8 KiB per line. The combined raw hard ceiling
is 4 MiB per step. Requests may only lower these values.

Structured logs and lifecycle events contain only allowlisted correlation, step, status, duration,
exit code, counts, hashes, truncation flags, resource outcomes and sanitized error codes. They never
contain source code, workspace payload, stdout/stderr text, host paths, prompts, specifications,
artifacts, environment values, credentials or Docker socket details.

## Cancellation and cleanup

The same optional signal is checked at every external boundary. Cancellation interrupts the active
Docker control command and removes the entire container so descendants cannot remain alive.
Timeout uses the same terminal cleanup path.

Cleanup is idempotent and coordinated through one owner. It executes exactly once for success,
failure, timeout and cancellation, uses its own bounded signal and deadline, and confirms container
removal. Cleanup does not retry the run. If cleanup cannot be confirmed, the final outcome records
`SANDBOX_CLEANUP_FAILED` and preserves the primary safe failure when one exists.

## Hashing, lineage and provenance

Hashes remain domain-separated and deterministic:

```text
TechnicalSpecificationHash
  -> GeneratedCodeBundleHash
  -> WorkspacePlanHash
  -> WorkspaceHash
  -> SandboxRequestHash
  -> SandboxResultHash
```

`policyHash` covers the image/runtime identity, helper ABI, dependency snapshot, command vectors,
environment, explicit step order and output sanitizer version. `limitsHash` separately covers every
effective resource, time and output ceiling. The sanitizer version is also recorded in provenance,
while hashes of the sanitized summaries, their counts and truncation outcomes enter
`SandboxResultHash`. `SandboxRequestHash` covers the trusted workspace lineage, workspace hash,
policy hash and effective limits.

Timestamps, durations, container IDs, container names, host paths, Docker socket and `AbortSignal`
remain observational and outside deterministic hashes. A result hash proves correlation and
integrity of the observed run; it does not claim bit-for-bit reproducible build output,
authorization, authenticity or code safety.

Lineage describes the ordered relationship from approved Technical Specification through bundle,
workspace and sandbox result. Provenance separately records runner and contract versions, policy
and command hashes, effective limits, Docker runtime, pinned image, platform, toolchain, helper ABI,
dependency snapshot and sanitizer version. Neither contains source content.

## Verification strategy

The normal test suite uses a fake Docker executor and validates exact command vectors, lifecycle,
limits, image pinning, stdin transfer, tampering, cancellation, timeout, resource errors, output
limits, sanitization and cleanup without requiring a daemon.

Real Docker tests are opt-in through `npm run test:sandbox:integration`. They require an explicitly
prepared local daemon and digest-pinned image, never pull or build automatically and remain outside
all normal quality gates. The standard suite must pass on hosts without Docker.

## Consequences

### Positive

- generated code never executes in the AI Factory process;
- the provider-neutral port is replaceable without exposing Docker as a domain contract;
- no host workspace or Docker socket is mounted;
- image, commands, dependencies and resource ceilings remain trusted host policy;
- cancellation and every terminal outcome converge on one verified cleanup path;
- output and logs remain bounded and sanitized;
- existing workflow, persistence and user interfaces remain unchanged.

### Trade-offs

- only projects matching an approved policy and offline dependency snapshot can run;
- Docker and its host kernel remain trusted infrastructure;
- build output is discarded and cannot be previewed or deployed;
- no workflow execution can invoke the runner yet;
- fixed limits can reject otherwise valid large projects;
- an abrupt host-process or daemon failure may require external orphan inspection in a future
  operational lifecycle.

## Explicit exclusions

This decision does not authorize direct host execution, arbitrary shell, commands from AI output,
package scripts, dependency lifecycle scripts, online dependency installation, network, privileged
containers, host namespaces, devices, ports, bind mounts, host volumes, Docker socket mounts,
retries, self-healing, workspace mutation, exported build artifacts, Preview, deploy, Git,
Repository or Prisma persistence, Observability integration, workflow integration, API, Frontend,
Factory View or any item of Sprint 24.
