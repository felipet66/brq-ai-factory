# ADR-037 — Agent Contract Invariant Alignment

## Status

Accepted — 2026-08-11.

## Context

Real Factory executions repeatedly passed JSON Schema and Zod validation but failed deterministic
Business Validation or Factory Execution Profile checks. The validators were correctly fail-closed;
the structural gap was that their invariants had no transverse inventory and some runtime profile
parameters reached the Code Generator without operational meaning.

## Decision

1. `@brq/agent-contract-invariants` is a read-only composition boundary. It imports the public,
   authoritative constants from Product Owner, Developer, QA, Code Generator and Factory Execution
   Profile. Agents and runtime validators do not depend on this catalog.
2. The catalog is versioned independently and records classification, deterministic ownership,
   active prompt versions/rule IDs and Factory Profile rule/reason-code bindings. Regression tests
   fail when an authoritative code or required prompt rule is added, removed or renamed without
   catalog alignment.
3. `GenerationProfileConstraints` `1.1.0` includes a normative `requirement` for each projected rule,
   plus the profile's build and preview semantics. Its hash uses a new projection domain. The
   Factory Execution Profile identity/hash and Sandbox snapshot remain unchanged.
4. Code Generator prompt `1.0.4` preserves the `1.0.0` output contract and all earlier bundles. It
   adds only the confirmed module/path preflight: module-owned files must live at the module path;
   root/shared files outside every module path use valid plan references without forged module
   ownership. Business Validation remains authoritative.
5. Derived-field contract removals are deferred to explicitly versioned v2 contracts. No existing
   output is silently rewritten and no validator is weakened.

## Consequences

- Profile-specific values remain supplied by the host rather than duplicated in a generic prompt.
- Projection hashes change deterministically, while profile and Sandbox snapshot hashes do not.
- New invariants require an explicit catalog and prompt-coverage decision.
- The approved stabilization is backward-compatible at agent output-contract level; future removal
  of readiness, summaries, counts or other model-authored derived fields remains a breaking change.
