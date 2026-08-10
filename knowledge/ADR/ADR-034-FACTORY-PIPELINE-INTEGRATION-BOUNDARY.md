# ADR-034 — Factory Pipeline Integration Boundary

## Status

Accepted

## Date

2026-08-09

## Context

ADR-022 fixes the Orchestrator as the deterministic Product Owner → Developer → QA workflow.
ADR-023 makes the Execution Engine the only component authorized to start that Orchestrator. ADR-032
then separates generated textual code from controlled filesystem materialization, and ADR-033
separates both capabilities from execution inside a provider-neutral Sandbox Runner.

Before Sprint 24 these components were intentionally disconnected. A normal execution became
terminal immediately after QA, while Code Generator, Controlled Workspace, and Sandbox Runner had
to be invoked independently. Persisting or observing the old Execution Engine outside a downstream
decorator would also record `SUCCESS` before generated software had been prepared, typechecked,
built, or tested.

The Sprint 23 Docker image is an adapter integration fixture with a fixed assertion. It is not a
general Factory runtime and cannot be selected silently for generated bundles.

## Decision

Create the private workspace `@brq/factory-pipeline` under `core/factory-pipeline`. Its
`FactoryPipelineCoordinator` wraps the public `ExecutionEngine` and then calls the public ports of
Code Generator, Controlled Workspace, and Sandbox Runner in a fixed sequential pipeline:

```text
Execution Engine (Product Owner → Developer → QA)
→ Code Generator
→ Workspace Plan
→ Workspace Materialization
→ Sandbox PREPARE
→ Sandbox TYPECHECK
→ Sandbox BUILD
→ Sandbox TEST
→ Workspace Release
→ FactoryExecutionResult
```

The coordinator receives the existing `ExecutionRequest`. It never accepts a WorkflowResult,
Technical Specification, approval envelope, generated bundle, workspace path, policy, image, or
command from HTTP. After the Engine succeeds, the coordinator derives Code Generator approval from
the public ExecutionResult and its verified QA handoff.

The Orchestrator and Execution Engine remain functionally unchanged. The Engine is still the only
component that invokes the Orchestrator. Its historical `ExecutionResult` and hashes retain their
meaning as the terminal result of the three-agent workflow. The coordinator introduces an additive
`FactoryExecutionResult` for the complete Factory lifecycle.

Observed and persistent Factory decorators wrap the coordinator, not the raw Engine. Therefore the
repository, job, and public execution become terminal only after downstream execution and resource
cleanup. Historical Engine decorators remain available for compatibility.

## Explicit boundary projections

Every handoff crosses a public contract and is revalidated:

```text
ExecutionResult
→ trusted CodeGenerationApproval + CodeGenerationRequest
→ CodeGeneratorAgentResult / GeneratedCodeBundle
→ WorkspacePlanRequest
→ WorkspacePlan / WorkspaceMaterializationResult
→ SandboxRunRequest
→ SandboxRunResult
→ FactoryExecutionResult
```

The bundle-to-workspace and workspace-to-sandbox projections live in the coordinator. Code
Generator and Controlled Workspace do not import each other. Controlled Workspace and Sandbox
Runner do not learn about agents, workflows, providers, prompts, persistence, or applications.

The coordinator revalidates outputs and correlation at every boundary. A structurally valid result
belonging to another execution, workspace, policy, or request is rejected as tampering.

## Lifecycle and fail-fast

The pipeline is sequential and invokes every capability at most once. A failed, rejected,
cancelled, or timed-out stage prevents every later functional stage from starting. Non-executed
stages are represented deterministically as `SKIPPED` without fabricated timestamps, metrics,
artifacts, or outputs.

Factory `SUCCESS` requires successful Product Owner, Developer, QA approval, Code Generator,
Workspace planning/materialization, all four Sandbox steps, confirmed container cleanup, and
confirmed workspace release. Build or test failure is a functional `FAILED` result and not an HTTP
transport error.

The same out-of-band AbortSignal crosses Engine, Code Generator, Controlled Workspace, and Sandbox
Runner. Controlled Workspace gains cooperative materialization cancellation and an explicit,
metadata-safe `release` operation. Once published, a workspace is released after success, failure,
timeout, or cancellation. Cleanup has an independent bounded deadline. An unconfirmed cleanup can
never be reported as success.

## Factory Docker profile

The application host owns a separate `NODE_TYPESCRIPT_24_V1` profile and versioned Docker image.
It is deliberately bounded to an offline Node.js 24.19.0 and TypeScript 6.0.3 toolchain. The image
uses fixed helpers for prepare, typecheck, build, and test; it never executes package scripts,
installs dependencies, selects commands from generated files, or accesses a network.

The profile does not weaken ADR-033. Image, policy, executable, Unix socket, canonical workspace
root, resource reductions, and immutable identity are explicit host configuration. Missing
configuration fails closed. Tests may inject a FakeSandboxRunner, but application runtime never
falls back to one automatically. Real Docker tests remain opt-in.

## Result, hashing, lineage, and provenance

`FactoryExecutionResult` is a strict, immutable, metadata-only contract. It contains terminal
status, safe stage outcomes, hashes, counts, durations, failure codes, lineage, and provenance. It
does not contain source code, generated file contents, prompts, complete specifications, artifacts,
raw model responses, raw stdout/stderr, host paths, container identifiers, or secrets.

Historical hashes are never recalculated. New domain-separated hashes extend the chain from the
existing execution hash through generation, bundle, workspace plan, materialized workspace,
sandbox request/result, and Factory result. Timestamps, durations, metrics, physical paths,
container identity, and AbortSignal remain outside functional hashes.

Factory lineage records hash-only handoffs. Factory provenance records component and contract
versions, approved assets, workspace policy/configuration, Sandbox policy and limits, pinned image,
helper ABI, runtime, toolchain, dependency snapshot, and sanitizer identity. Lineage and provenance
remain separate contracts.

## Observability and persistence

Observability v2 adds real stages for Code Generator, Workspace, PREPARE, TYPECHECK, BUILD, and
TEST while preserving v1 snapshots. The Engine's intermediate completion event does not terminalize
a v2 Factory record. Only the outer Factory result completes it. Events are derived from actual
calls; no timer or synthetic progress is permitted.

Persistence is additive and normalized. Existing records have no Factory projection. New tables
store only safe terminal metadata, ordered stages, hash-only lineage, allowlisted provenance, and
toolchain versions. Ownership is inherited from ExecutionRecord. Generated code, prompts,
specifications, outputs, filesystem state, and secrets are never persisted.

## Dependency boundary

Production code in `core/factory-pipeline` may depend only on public entrypoints of:

```text
@brq/execution-engine
@brq/code-generator-agent
@brq/controlled-workspace
@brq/sandbox-runner
@brq/shared
zod
node:crypto
```

It cannot import Orchestrator internals, the three functional agents, provider adapters, prompt
assets, filesystem adapters, Docker adapters, repositories, Prisma, HTTP, or applications. Concrete
filesystem and Docker adapters are selected only in the application composition root.

## Consequences

### Positive

- the Factory has one truthful terminal result;
- Engine and Orchestrator boundaries remain stable;
- generation, materialization, and execution remain independent authorities;
- build/test failure is observable without becoming an API transport failure;
- cancellation and cleanup span the complete lifecycle;
- historical records and hashes remain valid;
- Docker remains replaceable and absent from normal quality gates;
- no sensitive generated content reaches persistence or presentation.

### Trade-offs

- the initial Factory Docker profile supports only a bounded offline Node/TypeScript subset;
- incompatible or dependency-bearing projects fail closed;
- generated workspaces are intentionally removed and cannot be downloaded or previewed;
- a host-process or daemon crash can leave an orphaned staging directory, workspace, or container;
- recovery remains a documented manual operation;
- strict v2 contracts require coordinated updates across repository, API, and Factory View fixtures.

## Explicit exclusions

This decision does not authorize Preview Runner, serving generated applications, browser preview,
iframe, ports, network, deployment, Kubernetes, cloud sandbox, Git operations, project download,
artifact publication, retry, self-healing, autonomous correction, recovery daemon, parallel
execution, or any item of Sprint 25.
