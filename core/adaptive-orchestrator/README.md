# Adaptive Orchestrator

This package is the executable, provider-neutral foundation for the approved adaptive topology:

1. A deterministic classifier selects `SIMPLE_GREENFIELD` or `PLANNED` from explicit signals.
2. The Planner is bypassed for simple greenfield work and is required only for `PLANNED` work.
3. The Builder always receives the original demand, the immutable execution-profile descriptor, an optional plan, and a safe feedback field.
4. A deterministic Verifier decides `SUCCESS`, `CODE_FAILURE`, or `INFRA_FAILURE` without reporting model tokens.
5. The Reviewer repairs only a `CODE_FAILURE`, with a hard contract limit of two attempts.
6. `INFRA_FAILURE` creates a hash-bound checkpoint. `resume()` invokes only the Verifier: it never invokes Planner, Builder, or Reviewer and therefore adds zero AI tokens.

Diagnostics intentionally contain only whitelisted stage and reason-code enums. They cannot carry prompts, generated files, commands, paths, process output, provider responses, or arbitrary messages.

## Production boundary

This package is not wired into the current production pipeline yet. Doing that safely requires a new immutable Builder prompt/contract and adapters for artifact persistence and deterministic verification. Existing versioned prompts are intentionally untouched; activating this topology by adapting an old prompt would recreate the contract drift this package is meant to prevent.

The integration gate is therefore explicit: publish and approve a Builder bundle, implement the four ports, persist the checkpoint, and only then select this orchestrator in runtime configuration. Until that gate is met, this package is an independently tested foundation, not a silent behavior change.
