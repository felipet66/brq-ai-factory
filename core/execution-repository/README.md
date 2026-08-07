# Execution Repository

`@brq/execution-repository` is the durable, content-minimized execution-history boundary introduced
in Sprint 17. It owns the `ExecutionRecordRepository` port, an immutable in-memory adapter for
tests, a normalized Prisma adapter and host-level decorators that connect public Execution Engine
and Observability contracts to persistence.

The workspace contains no workflow or agent business rules. It never imports agents, prompt
assets, Knowledge Loader, Prompt Builder, AI Provider, Response Validator or Artifact Generator.
The concrete Execution Engine and the Sprint 16 observability reducer remain unchanged.

## Persisted allowlist

Records contain only technical identifiers, project name, lifecycle states and timestamps,
versions, sanitized failure codes, final hashes, lineage hashes and verified handoffs, provenance
hash metadata, timeline events, stage metrics and the minimized execution summary.

Prompts, demand descriptions, additional context, knowledge, specifications, model responses,
artifact contents, raw outputs, secrets, `AbortSignal` and internal runtime objects are never
persisted.

## Composition

The application host composes the decorators in this order:

```text
concrete Execution Engine
  -> observed Execution Engine
    -> persistent Execution Engine
```

The persistent coordinator writes `CREATED` and `RUNNING` before delegating exactly once, then
writes the terminal result and final observation atomically through the repository. The canonical
`executionId` remains nullable until the public Engine reveals it; active records use `workflowId`
for correlation.

See `knowledge/ADR/ADR-027-EXECUTION-REPOSITORY-BOUNDARY.md` and
`knowledge/41-EXECUTION_REPOSITORY_FLOW.md` for the authoritative decisions and diagrams.
