# Controlled Workspace Flow

## Purpose

The Controlled Workspace is the only Sprint 22 component authorized to create generated source
files. It has no AI, prompt, agent or execution dependencies. It treats every input file as
untrusted text even when it came from Code Generator.

## Boundary

```mermaid
flowchart LR
    Bundle["GeneratedCodeBundle"] --> Projection["Trusted caller projection"]
    Projection --> Request["WorkspacePlanRequest"]
    Request --> Planner["Pure Workspace Planner"]
    Planner --> Plan["Immutable WorkspacePlan"]
    Plan --> Adapter["Filesystem adapter"]
    Root["Absolute host-controlled root"] --> Adapter
    Adapter --> Workspace["Materialized textual workspace"]

    Model["AI model"] -. "No authority" .-> Root
    Bundle -. "No root field" .-> Root
```

The Code Generator and Controlled Workspace do not import each other. Contract projection is an
explicit trust transition and every path, byte count and hash is validated again.

## Path validation

```mermaid
flowchart TD
    Path["Candidate path"] --> Relative{"Relative POSIX path?"}
    Relative -- "No" --> Reject["Reject"]
    Relative -- "Yes" --> Normalized{"Already NFC?"}
    Normalized -- "No" --> Reject
    Normalized -- "Yes" --> Segments{"Safe non-hidden segments?"}
    Segments -- "No" --> Reject
    Segments -- "Yes" --> Extension{"Text extension allowlisted?"}
    Extension -- "No" --> Reject
    Extension -- "Yes" --> Collision{"Unique NFKC + lowercase key?"}
    Collision -- "No" --> Reject
    Collision -- "Yes" --> Accept["Plan entry accepted"]
```

Absolute POSIX paths, Windows drive/UNC paths, backslashes, traversal, null/control characters,
ambiguous normalization, platform-reserved names, hidden/sensitive segments and file/directory
collisions are rejected.

## Atomic materialization

```mermaid
sequenceDiagram
    participant C as Trusted caller
    participant P as Workspace Planner
    participant F as Filesystem adapter
    participant S as Private staging
    participant D as Final destination

    C->>P: plan(validated request)
    P-->>C: immutable WorkspacePlan + planHash
    C->>F: materialize(plan)
    F->>F: revalidate plan, root and destination
    F->>S: create staging exclusively
    loop Canonically ordered entries
        F->>S: create directory and non-executable file
    end
    F->>S: reread and verify bytes/hashes
    F->>D: atomic rename staging → final
    F->>D: reread and verify published destination
    F-->>C: MaterializedWorkspace + workspaceHash
```

The final destination is never overwritten. All writes happen under staging on the same
filesystem, and only rename publishes the result. A verification failure after rename removes the
owned destination and returns a sanitized failure; a published directory is never reported as a
successful workspace before this final verification completes.

## Failure and cleanup

```mermaid
flowchart TD
    Start["Materialization started"] --> Stage["Create owned staging"]
    Stage --> Write["Write and verify files"]
    Write --> Success{"All files verified?"}
    Success -- "Yes" --> Rename["Rename to final destination"]
    Rename --> VerifyPublished{"Published destination verified?"}
    VerifyPublished -- "Yes" --> Published["MATERIALIZED"]
    VerifyPublished -- "No" --> CleanupPublished["Remove owned destination"]
    CleanupPublished --> Failed
    Success -- "No" --> Cleanup["Remove owned staging"]
    Stage -- "Failure" --> Cleanup
    Rename -- "Failure" --> Cleanup
    Cleanup --> Failed["Canonical sanitized error"]
```

A caught failure removes the staging tree owned by that operation. A process crash can leave an
unpublished staging directory; automated orphan recovery is outside Sprint 22.

## Hash chain

```mermaid
flowchart LR
    Source["TechnicalSpecificationHash"] --> Bundle["BundleHash"]
    Bundle --> Content["Recomputed source-content hashes"]
    Content --> Plan["WorkspacePlanHash"]
    Plan --> Verify["Reread materialized files"]
    Verify --> Workspace["WorkspaceHash"]
```

Physical root, staging name, timestamps and durations do not participate in deterministic hashes.

## Future build boundary

```mermaid
flowchart LR
    Workspace["Materialized Workspace: untrusted data"] --> Future["Future isolated Build/Test Runner"]
    Future --> Sandbox["Sandbox + allowlisted commands"]
    Sandbox --> Limits["CPU / memory / time / network policy"]

    Workspace -. "Sprint 22 never crosses this boundary" .-> Sandbox
```

Sprint 22 does not install dependencies, invoke package managers, compile, test, preview or execute
the materialized files.
