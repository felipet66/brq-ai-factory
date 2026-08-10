# Factory Pipeline Flow

Sprint 24 connects the existing three-agent workflow to code generation, controlled
materialization, and isolated build/test execution. The integration coordinates public contracts;
it does not merge component authority.

## 1. Full Factory Pipeline

```mermaid
flowchart LR
    Human["Human Request"] --> Worker["Execution Worker"]
    Worker --> Coordinator["Factory Pipeline Coordinator"]
    Coordinator --> Engine["Execution Engine"]
    Engine --> PO["Product Owner"]
    PO --> Dev["Developer"]
    Dev --> QA["QA"]
    Coordinator --> Code["Code Generator"]
    Code --> Plan["Workspace Plan"]
    Plan --> Materialize["Workspace Materialization"]
    Materialize --> Sandbox["Sandbox Runner"]
    Sandbox --> Prepare["PREPARE"]
    Prepare --> Typecheck["TYPECHECK"]
    Typecheck --> Build["BUILD"]
    Build --> Test["TEST"]
    Test --> Release["Workspace Release"]
    Release --> Result["FactoryExecutionResult"]
```

## 2. Success Path

```mermaid
sequenceDiagram
    participant W as Worker
    participant F as Factory Pipeline
    participant E as Execution Engine
    participant C as Code Generator
    participant X as Controlled Workspace
    participant S as Sandbox Runner
    W->>F: execute(ExecutionRequest, AbortSignal)
    F->>E: execute(request, signal)
    E-->>F: ExecutionResult SUCCESS / QA READY
    F->>C: execute(derived approval, signal)
    C-->>F: GeneratedCodeBundle
    F->>X: plan(explicit projection)
    X-->>F: WorkspacePlan
    F->>X: materialize(plan, signal)
    X-->>F: WorkspaceMaterializationResult
    F->>S: run(explicit projection, signal)
    S-->>F: PREPARE/TYPECHECK/BUILD/TEST SUCCESS
    F->>X: release(workspace)
    X-->>F: RELEASED
    F-->>W: FactoryExecutionResult SUCCESS
```

## 3. Failure Propagation

```mermaid
flowchart TD
    Stage["Current stage"] --> Outcome{"Outcome"}
    Outcome -->|"SUCCESS"| Next["Start next stage"]
    Outcome -->|"FAILED / rejected / timeout"| Stop["Stop functional pipeline"]
    Outcome -->|"CANCELLED"| Cancel["Stop and clean resources"]
    Stop --> Skip["Mark later stages SKIPPED"]
    Cancel --> Skip
    Skip --> Cleanup{"Workspace published?"}
    Cleanup -->|"Yes"| Release["Controlled Workspace release"]
    Cleanup -->|"No"| Terminal["Terminal Factory result"]
    Release --> Terminal
```

## 4. Cancellation

```mermaid
sequenceDiagram
    participant U as Caller
    participant W as Worker
    participant F as Factory Pipeline
    participant A as Active Component
    participant R as Resource Cleanup
    U->>W: cancel(jobId)
    W-xF: AbortSignal
    F-xA: Same AbortSignal
    A-->>F: cancellation observed
    F->>R: bounded independent cleanup
    R-->>F: cleanup confirmed
    F-->>W: FactoryExecutionResult CANCELLED
```

## 5. Hash Chain

```mermaid
flowchart LR
    PO["ProductOwnerSpecificationHash"] --> TS["TechnicalSpecificationHash"]
    TS --> QA["QA Specification / approval hash"]
    QA --> Generation["generationHash"]
    Generation --> Bundle["bundleHash"]
    Bundle --> Plan["planHash"]
    Plan --> Workspace["workspaceHash"]
    Workspace --> Request["sandboxRequestHash"]
    Request --> Sandbox["sandboxResultHash"]
    Sandbox --> Factory["factoryResultHash"]
```

Historical workflow and execution hashes remain unchanged. Observational time and physical
resource identity do not enter this chain.

## 6. Lineage

```mermaid
flowchart TD
    POO["PO output hash"] --> DI["Developer input"]
    DI --> DO["Developer output hash"]
    DO --> QI["QA input"]
    QI --> QO["QA output / approval hash"]
    QO --> CI["Code Generator input"]
    CI --> CO["Generated bundle hash"]
    CO --> WI["Workspace plan input"]
    WI --> WO["Materialized workspace hash"]
    WO --> SI["Sandbox request hash"]
    SI --> SO["Sandbox result hash"]
```

## 7. Provenance

```mermaid
flowchart LR
    Agents["Agent and prompt versions"] --> Provenance["Factory Provenance"]
    Knowledge["Knowledge hashes"] --> Provenance
    Code["Code Generator assets / validation"] --> Provenance
    Workspace["Workspace version / policy"] --> Provenance
    Policy["Sandbox policy / limits"] --> Provenance
    Image["Image digest / helper ABI"] --> Provenance
    Runtime["Runtime / toolchain"] --> Provenance
    Provenance --> Hash["factoryProvenanceHash"]
```

## 8. Observability Timeline

```mermaid
timeline
    title Factory Observability v2
    KNOWLEDGE : real load evidence
    PRODUCT_OWNER : agent started : agent finished
    DEVELOPER : agent started : agent finished
    QA : agent started : agent finished
    CODE_GENERATOR : generation started : generation finished
    WORKSPACE : materialization started : materialization finished
    SANDBOX_PREPARE : step started : step finished
    SANDBOX_TYPECHECK : step started : step finished
    SANDBOX_BUILD : step started : step finished
    SANDBOX_TEST : step started : step finished
```

No timer creates progress. A stage changes only from correlated runtime evidence.

## 9. Workspace Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Planned
    Planned --> Staging: materialize
    Staging --> Published: atomic rename and verification
    Staging --> RolledBack: failure or cancellation
    Published --> InSandbox: verified projection
    InSandbox --> Releasing: sandbox terminal
    Published --> Releasing: downstream cancellation/failure
    Releasing --> Released: ownership and hash verified
    Released --> [*]
    RolledBack --> [*]
```

An abrupt process or daemon crash can leave an orphan. Sprint 24 documents manual inspection and
does not introduce a cleanup daemon or automatic recovery.

## 10. Trust Boundaries

```mermaid
flowchart LR
    User["Untrusted human input"] --> HTTP["HTTP validation"]
    HTTP --> Agents["Validated agent contracts"]
    Agents --> HostApproval["Trusted host approval"]
    HostApproval --> Bundle["Untrusted generated bundle"]
    Bundle --> Workspace["Independent path/content/hash validation"]
    Workspace --> Filesystem["Untrusted materialized filesystem"]
    Filesystem --> Sandbox["Independent reread and sandbox request validation"]
    Sandbox --> Container["Pinned isolated container"]
    Container --> Output["Untrusted bounded output"]
    Output --> Projection["Metadata-only result projection"]
    Projection --> Repository["Safe normalized persistence"]
    Projection --> UI["Factory View"]
```

The host selects policy and image. Generated data never selects commands, network, mounts,
credentials, execution limits, or persistence content.
