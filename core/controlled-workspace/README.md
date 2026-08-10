# Controlled Workspace

`@brq/controlled-workspace` is the trust boundary that turns an authorized textual file bundle
into an isolated directory. It has no dependency on the Code Generator or on any agent. Callers
map their public output to `WorkspacePlanRequest` using source hashes and declared file metadata.

## Two-phase flow

```text
WorkspacePlanRequest -> plan(request) -> immutable WorkspacePlan
WorkspacePlan        -> materialize(plan, { signal? }) -> immutable WorkspaceMaterializationResult
MaterializationResult -> release(result) -> immutable WorkspaceReleaseResult
```

Planning recalculates every file byte length and content hash, the ordered bundle content hash,
portable path collisions, effective policy/configuration hashes, and the deterministic plan hash.
Materialization accepts only the resulting plan and revalidates its schema, hashes, and the host's
effective limits before touching the filesystem.

The root directory is mandatory host configuration on the filesystem adapter. It never appears in
the request, hashes, result, or logs.

## Limits

- 96 files;
- 64 KiB per file;
- 384 KiB per bundle;
- 512 UTF-8 bytes per relative path;
- 20 path segments;
- 255 UTF-8 bytes per segment.

An instance may reduce these values, but cannot raise the absolute policy. Only UTF-8 textual files
with the closed media-type, extension, and purpose sets are accepted. Content is never truncated.

## Filesystem safety

The adapter accepts relative POSIX paths only and rejects absolute, drive, UNC, backslash,
traversal, control, hidden, sensitive, and Windows-reserved segments. Input must already be NFC;
collisions are detected using NFKC plus lowercase, including file/directory conflicts. Literal
high-confidence credentials and private-key material are rejected while environment-variable
references remain allowed.

Files are written exclusively into a private staging directory, verified byte-for-byte, atomically
renamed, and verified again. Existing destinations are never overwritten. Symlinks and non-regular
filesystem entries are rejected, and failed staging or post-rename verification is cleaned up.
Materialization observes cancellation cooperatively at filesystem boundaries and rolls back the
owned staging or published directory before returning a cancellation. Cleanup uses a separate,
host-configured deadline (10 seconds by default, at most 30 seconds) and is never retried
implicitly. The module never invokes a shell or network operation.

`release(result)` is the only public deletion capability. It accepts no path, uses only ownership
recorded by the adapter instance, revalidates root and destination filesystem identities, and
verifies the public plan/workspace hashes plus on-disk file hashes before deletion. Successful,
concurrent, and repeated releases share one immutable metadata-only outcome. A failed cleanup is
also retained and is not retried implicitly. If owned file bytes were tampered, release removes the
owned directory but reports the verification failure; if ownership identity changed, it deletes
nothing.

## Public entry points

- `@brq/controlled-workspace`: contracts, schemas, limits, planner, and mapping hash helpers;
- `@brq/controlled-workspace/filesystem`: the host-configured filesystem adapter;
- `@brq/controlled-workspace/testing`: deterministic request fixtures only.

The materialization result excludes file content and separates `lineage` from `provenance`.
Lineage connects the technical specification, bundle, plan, and workspace hashes. Provenance
records versions, adapter, policy/configuration hashes, and aggregate file metadata. Durations and
the host root are observational and never participate in deterministic hashes.

## Usage

```ts
import { createFilesystemControlledWorkspace } from '@brq/controlled-workspace/filesystem';

const workspace = createFilesystemControlledWorkspace({ rootPath: hostOwnedRoot });
const plan = workspace.plan(mappedWorkspacePlanRequest);
const result = await workspace.materialize(plan, { signal });
try {
  // Pass result to the next explicit boundary.
} finally {
  await workspace.release(result);
}
```

The caller owns only the public mapping. It cannot provide a destination path, and materialization
does not execute, install, build, test, or otherwise evaluate the generated files.

## Logs

The adapter emits `controlled_workspace.plan.created`,
`controlled_workspace.materialization.started`,
`controlled_workspace.materialization.completed`, and
`controlled_workspace.materialization.failed`, plus `controlled_workspace.release.started`,
`controlled_workspace.release.completed`, and `controlled_workspace.release.failed`. Records
contain only identifiers, hashes, counts, byte totals, duration, and sanitized error code/stage.
They never contain root paths, relative file paths, content, credentials, prompts, specifications,
artifacts, cancellation reasons, or model responses. Logging is best effort and cannot change
planning, materialization, or release outcomes.

## Exclusions

This workspace does not generate code, call agents/providers, execute commands, access the network,
install dependencies, persist execution history, overwrite an existing destination, accept binary
files, or expose a general-purpose filesystem API. The host still owns lifecycle orchestration;
this boundary owns only safe materialization rollback and explicit release of directories it
created.
