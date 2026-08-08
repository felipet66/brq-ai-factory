# ADR-032 — Code Generation and Controlled Workspace Boundary

## Status

Accepted

## Date

2026-08-08

## Context

The AI Factory can complete the deterministic Product Owner → Developer → QA workflow and produce
validated functional, technical and quality specifications. The Developer Agent is deliberately an
architect: ADR-020 excludes source-code generation, commands and filesystem access from its
boundary. ADR-018 also defines generated artifacts as in-memory drafts with flat logical filenames,
not filesystem paths.

The next capability must transform a technically approved `TechnicalSpecification` into textual
source files without granting an AI model authority over the host. Model output, even after
structural validation, remains untrusted data. Generating source code must not imply installing,
building, testing or executing it.

## Decision

Create two independent workspaces:

- `agents/code-generator`, an AI-backed functional facade that produces a deterministic,
  validated `GeneratedCodeBundle`;
- `core/controlled-workspace`, a provider-neutral filesystem boundary that plans and atomically
  materializes validated text files below a host-controlled root.

The modules do not import one another. A trusted application caller must explicitly project a
`GeneratedCodeBundle` into the independent `WorkspacePlanRequest`. This repeated validation is a
security boundary, not accidental duplication.

Sprint 22 does not connect either module to Orchestrator, Execution Engine, Worker, Queue, API,
Frontend, Factory View, Repository or Prisma. The existing workflow and all of its hashes,
lineage, provenance, stages and events remain unchanged.

## Code Generator

The Code Generator receives a public `TechnicalSpecification` through an approval-evidence
envelope. In Sprint 22, approved means a trusted caller observed a successful workflow, Developer
and QA results with `READY`, and a verified technical handoff. It does not mean human review or a
cryptographic authorization. The facade recalculates the canonical specification hash and rejects
inconsistent readiness, correlation or evidence before invoking the provider.

Each invocation performs:

1. strict request and source validation;
2. focused `CODE_GENERATOR` Knowledge loading;
3. projection of Knowledge and Technical Specification as untrusted input contexts;
4. exactly one Agent Runner invocation;
5. structural validation by Response Validator;
6. code-specific Business Validation;
7. deterministic bundle assembly, hashing and deep freezing.

The raw model response contains only textual files, entrypoints and traceability references. The
model cannot provide authoritative hashes, sizes, versions, lineage or provenance. The assembler
calculates those values server-side after validation.

The facade depends only on public contracts from Developer Agent and generic core modules. It does
not import AI Provider adapters, Artifact Generator, filesystem, orchestration, execution,
persistence or applications. It performs no retry.

The existing Artifact Generator is not extended. Its template count and flat filenames are trusted
server configuration, while a code bundle has a dynamic number of nested paths proposed by an
untrusted model. Combining these semantics would weaken ADR-018.

## Knowledge and prompt budget

The shared agent identity gains the additive value `CODE_GENERATOR`. Workflow-specific enums remain
closed over Product Owner, Developer and QA.

Knowledge Selection Policy `1.13.0` adds a focused `CODE_GENERATOR` context containing only tech
stack, coding standards, testing and security. Existing context matrices and Knowledge Manifest
`1.12.0` remain unchanged. The Code Generator requests at most 48 KiB of Knowledge.

The Prompt Builder global default remains 128 KiB and the existing application runtime remains
configured at 512 KiB. Code Generator requests use an explicit 384 KiB ceiling. A serialized
Technical Specification is limited to 224 KiB. Excess is rejected without truncation or provider
invocation.

## Generated code contract

Only UTF-8 text is supported. The initial limits are 96 files, 64 KiB per file, 384 KiB of total
content, 16 entrypoints, paths up to 512 UTF-8 bytes and 20 segments. Requests may lower but never
raise the Code Generator invocation budgets; Controlled Workspace host configuration may similarly
lower, but never raise, its materialization ceilings. Generated-bundle shape limits remain fixed by
contract version.

Business Validation checks:

- non-empty bundle and valid entrypoints;
- path portability and collision safety;
- allowlisted media types, purposes and extensions;
- byte limits and valid Unicode scalar content;
- traceability to known module and implementation-plan IDs;
- coverage of eligible source modules;
- sensitive filenames and high-confidence secret material;
- consistency between required files, manifest and profile.

The initial profile creates a new isolated snapshot. A Technical Specification requiring modification
or deletion of an existing source tree is rejected because no trusted source snapshot exists.
CREATE module roots must also satisfy the portable path policy and be free of exact portable
collisions; this eligibility check runs before Knowledge loading or provider invocation so the
model is never asked to satisfy an impossible handoff.

## Controlled Workspace

The main entrypoint exposes contracts, schemas, configuration, planning and canonical errors. The
concrete local adapter is exposed only through the explicit `./filesystem` subpath.

The allowed root is an absolute, pre-existing, non-symlink path supplied when the adapter is
constructed. It never comes from a model, bundle or materialization request and there is no fallback
to the AI Factory repository root.

Paths must be relative POSIX paths already normalized to NFC. The boundary rejects absolute paths,
Windows drive and UNC paths, backslashes, null/control characters, empty, `.` or `..` segments,
hidden or sensitive segments and unsafe platform filenames. Collision keys use NFKC plus
case-folding so exact, case-insensitive, Unicode and file-versus-directory collisions are rejected.

The workspace repeats content, media type, extension, byte, collision and hash validation even when
the input originated from Code Generator. It never assumes that a caller preserved the prior
contract.

## Atomic materialization

The planner is pure and produces an immutable, canonically ordered `WorkspacePlan`. Materialization
then:

1. revalidates the plan and its hashes;
2. verifies the configured root through `lstat` and `realpath`;
3. rejects an existing destination;
4. creates a private staging directory on the same filesystem;
5. creates directories and non-executable files with exclusive writes;
6. rereads and verifies every staged file;
7. publishes the complete directory with one rename;
8. rereads and verifies the published destination;
9. removes owned staging or published state on any caught failure.

Only the final rename publishes a workspace. A partial staging tree is never a successful result.
An abrupt process crash can leave an unpublished staging directory; recovery and retention are
future lifecycle concerns.

Portable Node filesystem APIs cannot remove every time-of-check/time-of-use window against a local
attacker that can mutate the configured root concurrently. Therefore the root must be owned by the
host and not writable by untrusted processes.

## Hashing, lineage and provenance

Hashes are domain-separated and distinguish exact UTF-8 content, file structure, bundle content,
bundle structure, generation, workspace plan and materialized workspace. The chain preserves:

```text
TechnicalSpecificationHash → BundleHash → WorkspacePlanHash → WorkspaceHash
```

Physical root, staging path, timestamps and durations are observational and stay outside
deterministic hashes. Hashes provide integrity and correlation, not identity, authorization or
authenticity.

Lineage records relationships between the approved source, generated bundle, plan and workspace.
Provenance records versions, trusted asset hashes, Knowledge metadata, provider/model, prompt,
response, validation, generation and workspace-policy hashes. Neither contains source content.

## Persistence and observability

Workspace content remains on the configured local filesystem. Sprint 22 does not persist content or
metadata in the Execution Repository. Without an integrated owner/lifecycle, adding Prisma records
would create ambiguous terminal states and impossible cross-resource atomicity.

The modules emit sanitized structured events containing only technical IDs, versions, stages,
outcomes, hashes, counts, bytes, durations and safe error codes. Existing execution Observability is
not extended because Code Generation is not an execution stage in this Sprint.

## Consequences

### Positive

- AI generation and filesystem authority are separated;
- source files are validated twice across an explicit trust boundary;
- materialization cannot silently truncate, normalize or overwrite;
- the existing agents and workflow remain stable;
- generated code can be inspected as data without gaining execution capability;
- no new third-party dependency is required.

### Trade-offs

- an execution cannot generate code later by ID because the full specification is not persisted;
- no API, UI or Factory station invokes or displays the capability;
- code quality and compilability are unknown until a future isolated runner exists;
- projects beyond the one-response and bundle limits are rejected rather than chunked;
- local workspace retention and crash recovery are not managed;
- modifying an existing repository is unsupported.

## Explicit exclusions

This decision does not authorize shell, subprocesses, package managers, dependency installation,
build, tests, Playwright, containers, deployment, Git operations, network access by generated code,
preview, retry, self-healing, autonomous correction, API/frontend integration, workflow integration,
workspace persistence or any item of Sprint 23.
