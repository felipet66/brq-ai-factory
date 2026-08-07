# Execution Worker

`@brq/execution-worker` is the Sprint 18 boundary that dispatches validated execution requests to
the replaceable `JobQueue` port and consumes them sequentially through the public Execution Engine.

The dispatcher reserves the canonical `executionId` through the Engine-owned identity API,
derives the one-to-one deterministic `jobId`, creates the durable queued record, and only then
exposes the payload to the in-memory queue. The
worker claims FIFO jobs, persists their lifecycle and invokes `ExecutionEngine.execute()` exactly
once. After the queue reaches a terminal state, the Worker projects the returned `JobRecord`
status and `finishedAt` into the repository; this timestamp remains distinct from the Engine
result timestamp. It never imports agents, the Orchestrator, Prisma or lower AI pipeline
components.

Queue polling is not execution retry. A failed or cancelled job is terminal and is never requeued.
The HTTP request signal is deliberately not propagated after the server accepts a job; each running
job owns an internal `AbortController` used only by explicit worker cancellation and shutdown.

The workspace stores no payload itself. `ExecutionRequest` lives only inside the queue while the job
is active and is removed by the in-memory adapter at terminal transition.

The host starts one Worker. `shutdown()` rejects new dispatches, cancels queued jobs, requests
cooperative cancellation of the active job and waits for its settlement. Infrastructure failures
are sanitized and terminal; no failure path requeues or performs a second Engine call.

Because SQLite and the local queue do not share a transaction, a failed enqueue after durable
creation is compensated by marking its job metadata `CANCELLED`. Crash recovery, stale-record
reconciliation, multiple consumers and distributed execution are outside Sprint 18.
