import { describe, expect, it } from 'vitest';

import type {
  WorkspaceMaterializationResult,
  WorkspacePlan,
  WorkspacePlanRequest,
  WorkspaceReleaseResult,
} from './contracts';
import {
  DEFAULT_CONTROLLED_WORKSPACE_CLEANUP_TIMEOUT_MS,
  MAX_CONTROLLED_WORKSPACE_CLEANUP_TIMEOUT_MS,
  workspaceReleaseResultSchema,
} from './index';
import { createWorkspacePlanRequestFixture } from './testing/controlled-workspace-fixtures';
import { createWorkspacePlan } from './workspace-planner';

function assertPublicOutputsAreDeeplyReadonly(
  plan: WorkspacePlan,
  result: WorkspaceMaterializationResult,
): void {
  // @ts-expect-error -- WorkspacePlan metadata is a deeply readonly public output.
  plan.metadata.planHash = 'mutated';
  // @ts-expect-error -- WorkspacePlan files are exposed as a readonly collection.
  plan.files.push(plan.files[0]);
  // @ts-expect-error -- Nested source hashes remain readonly.
  plan.source.bundleHash = 'mutated';
  // @ts-expect-error -- Materialization provenance is deeply readonly.
  result.provenance.adapter = 'MUTATED';
  // @ts-expect-error -- Materialized files are exposed as a readonly collection.
  result.files.splice(0, 1);
}

function assertPublicInputIsDeeplyReadonly(request: WorkspacePlanRequest): void {
  // @ts-expect-error -- Public request collections follow the project-wide readonly convention.
  request.files.push(request.files[0]);
  // @ts-expect-error -- Nested source hashes in public requests are readonly.
  request.source.bundleHash = 'mutated';
  // @ts-expect-error -- Individual requested file fields are readonly.
  request.files[0].path = 'mutated.ts';
}

void assertPublicOutputsAreDeeplyReadonly;
void assertPublicInputIsDeeplyReadonly;

function assertReleaseOutputIsReadonly(result: WorkspaceReleaseResult): void {
  // @ts-expect-error -- Release metadata is an immutable public output.
  result.status = 'RELEASED';
  // @ts-expect-error -- Correlation hashes cannot be reassigned by callers.
  result.workspaceHash = 'mutated';
}

void assertReleaseOutputIsReadonly;

describe('controlled workspace public output types', () => {
  it('matches the compile-time readonly contract with runtime deep freezing', () => {
    const plan = createWorkspacePlan(createWorkspacePlanRequestFixture());
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.metadata)).toBe(true);
    expect(Object.isFrozen(plan.files)).toBe(true);
    expect(Object.isFrozen(plan.source)).toBe(true);
  });

  it('exports the additive lifecycle contract from the public barrel', () => {
    expect(DEFAULT_CONTROLLED_WORKSPACE_CLEANUP_TIMEOUT_MS).toBe(10_000);
    expect(MAX_CONTROLLED_WORKSPACE_CLEANUP_TIMEOUT_MS).toBe(30_000);
    expect(workspaceReleaseResultSchema).toBeDefined();
  });
});
