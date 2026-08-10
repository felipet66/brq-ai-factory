# Preview Runner Flow

Sprint 25 turns an already approved Factory build into a short-lived, explicitly requested Preview.
It exports a safe artifact while preserving normal Sandbox and Controlled Workspace cleanup.

## 1. Factory SUCCESS to Preview

```mermaid
sequenceDiagram
    participant U as User
    participant F as Factory Pipeline
    participant S as Sandbox Build Container
    participant A as Preview Artifact Store
    participant W as Controlled Workspace
    participant API as Preview API
    participant P as Preview Runner
    participant C as Preview Container
    F->>S: PREPARE → TYPECHECK → BUILD → TEST
    S-->>A: stage canonical artifact candidate
    S-->>F: SandboxResult SUCCESS
    F->>W: release(workspace)
    W-->>F: RELEASED
    F-->>A: approve exact Factory/Sandbox/hash correlation
    F-->>U: FactoryExecutionResult SUCCESS
    U->>API: Start Preview (explicit)
    API->>A: read approved artifact
    API->>P: start(host-approved request)
    P->>C: prepare isolated runtime
    P->>C: host-controlled health probe
    C-->>P: healthy
    P-->>API: PreviewSession RUNNING
    API-->>U: View Build available
```

The artifact candidate cannot authorize itself. A failed or mismatched Factory result removes the
candidate. Preview never retains the original workspace or build container.

## 2. Preview lifecycle

```mermaid
stateDiagram-v2
    [*] --> CREATED: explicit request
    CREATED --> STARTING: policy and artifact approved
    STARTING --> RUNNING: container + health evidence
    CREATED --> FAILED: validation failure
    STARTING --> FAILED: startup / health / cancellation failure
    RUNNING --> STOPPING: manual stop
    RUNNING --> STOPPING: TTL reached
    RUNNING --> STOPPING: reconciliation
    STOPPING --> STOPPED: manual cleanup confirmed
    STOPPING --> EXPIRED: expiration cleanup confirmed
    STOPPING --> FAILED: cleanup not confirmed
    STOPPED --> [*]
    EXPIRED --> [*]
    FAILED --> [*]
```

There is no retry, restart, resume, self-healing, or implicit alternate runtime.

## 3. Container isolation

```mermaid
flowchart TB
    Host["Trusted application host"] -->|"fixed Docker control plane"| Container["Dedicated Preview container"]
    Artifact["Approved bounded artifact"] -->|"canonical stdin envelope"| Container
    Policy["NODE_WEB_PREVIEW_24_V1 policy"] --> Container
    Container --> Tmpfs["bounded /preview tmpfs"]
    Container --> ContainerLoopback["container loopback :8080"]
    Gateway["authenticated reverse proxy"] -->|"ephemeral private capability"| HostRelay["ephemeral host relay on 127.0.0.1"]
    HostRelay -->|"fixed docker exec helper; GET/HEAD only"| ContainerLoopback
    Internet["Internet / LAN"] -. "blocked egress" .- Container
    HostFs["Host filesystem / Docker socket / secrets"] -. "never mounted" .- Container
```

The runtime is separate from the build Sandbox, non-root, read-only, capability-free, resource
limited, and attached to an internal no-egress network. Docker publishes no container port. The
trusted host relay is bound only to `127.0.0.1` and can invoke only the fixed relay helper inside the
verified container. Every relay request also requires an unpersisted, in-memory capability token.

## 4. Authenticated unique-origin launch

```mermaid
sequenceDiagram
    participant B as Browser on Factory origin
    participant F as Factory API
    participant R as Preview Repository
    participant O as Unique Preview origin
    participant G as Preview Gateway
    participant C as Preview Container
    B->>F: POST /previews/:id/launch (session + CSRF)
    F->>R: verify owner/admin and RUNNING session
    F->>R: store one-time ticket hash
    F-->>B: trusted auto-submit form + raw one-time ticket
    B->>O: POST /_brq/redeem
    O->>R: atomically consume ticket hash
    R-->>O: Preview grant
    O-->>B: host-only HttpOnly Preview cookie + redirect
    B->>G: GET asset with Preview cookie
    G->>R: validate cookie + RUNNING/TTL
    G->>C: bounded GET through private target
    C-->>G: static response
    G-->>B: allowlisted headers + security policy
```

Factory cookies and storage are not sent to the Preview origin. The ticket is not reusable and is
revoked when the session stops or expires.

## 5. Factory View and View Build

```mermaid
flowchart LR
    Factory["Factory View"] --> Eligibility{"Real Factory evidence"}
    Eligibility -->|"not SUCCESS / no artifact"| Unavailable["Preview unavailable"]
    Eligibility -->|"eligible"| Start["Start Preview"]
    Start --> Starting["STARTING"]
    Starting -->|"health success"| Running["RUNNING"]
    Starting -->|"failure"| Failed["FAILED"]
    Running --> View["View Build in unique origin"]
    Running --> Stop["Stop Preview"]
    Running --> Expire["TTL expires"]
    Stop --> Stopped["STOPPED + cleanup"]
    Expire --> Expired["EXPIRED + cleanup"]
```

The browser polls only persisted/runtime-backed session state. Preview is never inferred from a
timer and is never auto-started.

## 6. TTL, reconciliation, and cleanup

```mermaid
flowchart TD
    Trigger{"Stop trigger"} -->|"manual"| Stop["idempotent stop owner"]
    Trigger -->|"TTL"| Stop
    Trigger -->|"cancel"| Stop
    Trigger -->|"lost runtime"| Stop
    Trigger -->|"startup failure"| Stop
    Stop --> RemoveContainer["remove container"]
    RemoveContainer --> RemoveNetwork["remove private network"]
    RemoveNetwork --> RemoveArtifact["consume / remove ephemeral artifact"]
    RemoveArtifact --> Revoke["revoke outstanding ticket"]
    Revoke --> Confirm{"all required cleanup confirmed"}
    Confirm -->|"yes"| Terminal["STOPPED or EXPIRED"]
    Confirm -->|"no"| Failure["FAILED / PREVIEW_CLEANUP_FAILED"]
```

Process restart does not make a database row live. Reconciliation compares persisted metadata with
runtime evidence and expires stale sessions through the same cleanup owner.

## 7. Hash chain

```mermaid
flowchart LR
    FactoryHash["factoryResultHash"] --> SandboxHash["sandboxResultHash"]
    SandboxHash --> WorkspaceHash["workspaceHash"]
    WorkspaceHash --> ArtifactContent["artifactContentHash"]
    ArtifactContent --> ArtifactHash["artifactHash"]
    ArtifactHash --> ApprovalHash["artifactApprovalHash"]
    ApprovalHash --> RequestHash["previewRequestHash"]
    RequestHash --> LineageHash["previewLineageHash"]
    RequestHash --> ProvenanceHash["previewProvenanceHash"]
    LineageHash --> SessionHash["previewSessionHash"]
    ProvenanceHash --> SessionHash
```

Timestamps, durations, tickets, cookies, host paths, ports, container identity, and AbortSignal are
observational or private and never enter deterministic hashes.

## 8. Deployment boundary

```mermaid
flowchart LR
    FactorySuccess["Factory SUCCESS"] --> Preview["Temporary Preview"]
    Preview --> Stop["Stop / Expire / Cleanup"]
    Preview -. "future explicit authority" .-> Deploy["Deployment"]
    Deploy -. "not implemented in Sprint 25" .-> Production["Production hosting / DNS"]
```

Preview proves that a bounded approved static artifact can be viewed temporarily. It is not a
deployment or production hosting decision.
