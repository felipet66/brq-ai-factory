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
hash metadata, timeline events, stage metrics, the minimized execution summary and normalized job
metadata (`jobId`, status, `queuedAt`, `startedAt`, `finishedAt`).

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
writes the terminal result and final observation atomically through the repository. For the Sprint
18 asynchronous path, the dispatcher first uses the Engine-owned identity API and creates the
`ExecutionRecord` plus its one-to-one `ExecutionJob` in `QUEUED`. The Worker changes job metadata to
`RUNNING` before invoking the same persistent Engine and projects the terminal state afterward.

The request payload is never stored by this workspace. There is no distributed transaction
between SQLite and the process-local queue: if enqueue fails after durable creation, the dispatcher
marks the job `CANCELLED`. A process crash may leave `QUEUED` or `RUNNING` metadata stale because
recovery, retry and requeue are intentionally out of scope.

See `knowledge/ADR/ADR-027-EXECUTION-REPOSITORY-BOUNDARY.md` and
`knowledge/41-EXECUTION_REPOSITORY_FLOW.md` for the base repository boundary, and ADR-028 plus
`knowledge/42-JOB_QUEUE_FLOW.md` for the additive job integration.
