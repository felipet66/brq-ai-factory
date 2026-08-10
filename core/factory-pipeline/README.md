# Factory Pipeline

`@brq/factory-pipeline` is the application-neutral coordinator for the complete, sequential AI Factory lifecycle:

```text
Execution Engine
  -> Code Generator
  -> Controlled Workspace plan
  -> Controlled Workspace materialization
  -> Sandbox PREPARE
  -> Sandbox TYPECHECK
  -> Sandbox BUILD
  -> Sandbox TEST
  -> Workspace release
```

The module composes public ports only. It does not know agent internals, prompt construction, AI providers, filesystem implementations, Docker, repositories, HTTP, or UI code. The host injects the trusted Code Generator configuration and Sandbox policy identifier.

## Public contract

`FactoryPipelineCoordinator.execute()` accepts the existing `ExecutionRequest`. The coordinator invokes `ExecutionEngine.execute()` itself and derives the Code Generator approval from the resulting public `ExecutionResult`; callers cannot author an approval or supply an execution hash.

`FactoryExecutionResult` is an additive, metadata-only result. It contains terminal statuses, bounded failures, observations, safe hashes, lineage, provenance, workspace metadata, Sandbox step metadata, and sanitized output hashes/counts. It never carries specifications, generated source, prompts, knowledge content, artifacts, output text, paths on the host, container identifiers, or secrets. The existing `ExecutionResult` and `WorkflowResult` contracts and hashes remain unchanged.

Factory `SUCCESS` requires every one of the eleven canonical stages to succeed. A build or test failure is a resolved functional `FAILED` result, not a transport exception. Cancellation resolves to `CANCELLED` whenever a terminal Execution Engine result exists. A technical failure without any trustworthy terminal result is raised as `FactoryPipelineError`.

The aggregate `SANDBOX` value is allowed only as `terminalStage`/`failure.stage` for runner lifecycle failures after the four functional Sandbox steps. It is not a twelfth stage and therefore does not rewrite a successful `TEST` observation.

## Trust and lifecycle

- `GeneratedCodeBundle` is reparsed and correlated before projection.
- `WorkspacePlan`, materialization, release, and `SandboxRunResult` are reparsed at every boundary.
- Generated bundle, plan, workspace, Sandbox request, and Sandbox result hashes form an explicit chain.
- `AbortSignal` crosses Execution Engine, Code Generator, workspace materialization, and Sandbox execution.
- Workspace release is host-owned, deadline-bounded by Controlled Workspace, and invoked after every successful materialization, including failure and cancellation paths.
- No retry or parallel execution is implemented.
- Observational timestamps and durations never participate in functional hashes.

The package testing export provides deterministic configuration/result fixtures. Normal tests use fake ports and never require OpenAI or Docker.

The real Factory profile integration remains opt-in and requires a preloaded, digest-pinned image
plus the explicit host configuration documented in the root README:

```sh
BRQ_FACTORY_SANDBOX_INTEGRATION=1 npm run test:factory:integration
```

It is excluded from the normal test and coverage gates and never pulls or builds an image.
