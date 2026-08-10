import { describe, expect, it } from 'vitest';

import type { WorkspacePlan, WorkspacePlanFile } from './contracts';
import {
  calculateMaterializedWorkspaceHash,
  calculateWorkspaceBundleContentHash,
  calculateWorkspaceContentHash,
  calculateWorkspaceFileStructuralHash,
  calculateWorkspacePlanHash,
  deriveWorkspaceId,
} from './hashing';
import {
  workspaceFileMediaTypeSchema,
  workspaceFilePurposeSchema,
  workspaceMaterializationResultSchema,
  workspacePlanRequestSchema,
  workspacePlanSchema,
  workspaceReleaseResultSchema,
} from './schemas';
import { createWorkspacePlan } from './workspace-planner';
import { createWorkspacePlanRequestFixture } from './testing/controlled-workspace-fixtures';

function rehashPlan(
  template: WorkspacePlan,
  inputs: readonly (Omit<WorkspacePlanFile, 'byteLength' | 'contentHash' | 'structuralHash'> & {
    readonly content: string;
  })[],
) {
  const files = inputs
    .map((file) => {
      const byteLength = Buffer.byteLength(file.content, 'utf8');
      const contentHash = calculateWorkspaceContentHash(file.content);
      return {
        ...file,
        byteLength,
        contentHash,
        structuralHash: calculateWorkspaceFileStructuralHash({
          path: file.path,
          encoding: file.encoding,
          mediaType: file.mediaType,
          purpose: file.purpose,
          byteLength,
          contentHash,
        }),
      };
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const source = {
    ...template.source,
    bundleContentHash: calculateWorkspaceBundleContentHash(files),
  };
  const planHash = calculateWorkspacePlanHash({
    source,
    files,
    policyHash: template.metadata.policyHash,
    configurationHash: template.metadata.configurationHash,
  });
  return {
    workspaceId: deriveWorkspaceId(planHash),
    source,
    files,
    metadata: {
      ...template.metadata,
      fileCount: files.length,
      totalBytes: files.reduce((total, file) => total + file.byteLength, 0),
      planHash,
    },
    lineage: {
      technicalSpecificationHash: source.technicalSpecificationHash,
      bundleHash: source.bundleHash,
      bundleContentHash: source.bundleContentHash,
      planHash,
    },
  };
}

function resultFromRehashedPlan(plan: ReturnType<typeof rehashPlan>) {
  const files = plan.files.map((file) => ({
    path: file.path,
    encoding: file.encoding,
    mediaType: file.mediaType,
    purpose: file.purpose,
    byteLength: file.byteLength,
    contentHash: file.contentHash,
    structuralHash: file.structuralHash,
  }));
  const workspaceHash = calculateMaterializedWorkspaceHash({
    workspaceId: plan.workspaceId,
    planHash: plan.metadata.planHash,
    source: plan.source,
    files,
    policyHash: plan.metadata.policyHash,
    configurationHash: plan.metadata.configurationHash,
  });
  return {
    workspaceId: plan.workspaceId,
    source: plan.source,
    files,
    metadata: { ...plan.metadata, workspaceHash },
    lineage: { ...plan.lineage, workspaceHash },
    provenance: {
      workspaceVersion: plan.metadata.workspaceVersion,
      contractVersion: plan.metadata.contractVersion,
      sourceBundleVersion: plan.source.bundleVersion,
      sourceContractVersion: plan.source.contractVersion,
      adapter: 'FILESYSTEM',
      policyHash: plan.metadata.policyHash,
      configurationHash: plan.metadata.configurationHash,
      fileCount: plan.metadata.fileCount,
      totalBytes: plan.metadata.totalBytes,
    },
  };
}

describe('controlled workspace schemas', () => {
  it('accepts the public request and plan contracts', () => {
    const request = createWorkspacePlanRequestFixture();
    expect(workspacePlanRequestSchema.safeParse(request).success).toBe(true);
    expect(workspacePlanSchema.safeParse(createWorkspacePlan(request)).success).toBe(true);
  });

  it('keeps the textual media types and purposes closed', () => {
    expect(workspaceFileMediaTypeSchema.options).toEqual([
      'application/json',
      'application/sql',
      'application/yaml',
      'text/css',
      'text/html',
      'text/javascript',
      'text/markdown',
      'text/plain',
      'text/typescript',
      'text/xml',
      'text/x-prisma',
    ]);
    expect(workspaceFilePurposeSchema.options).toEqual([
      'SOURCE',
      'TEST',
      'CONFIGURATION',
      'DOCUMENTATION',
      'STYLE',
      'SCHEMA',
    ]);
  });

  it('rejects unknown fields at every public input boundary', () => {
    const request = createWorkspacePlanRequestFixture();
    expect(
      workspacePlanRequestSchema.safeParse({ ...request, internalAgent: 'DEVELOPER' }).success,
    ).toBe(false);
    expect(
      workspacePlanRequestSchema.safeParse({
        ...request,
        files: [{ ...request.files[0], absolutePath: '/tmp/output.ts' }],
      }).success,
    ).toBe(false);
  });

  it('rejects tampered plans and materialization results', () => {
    const plan = createWorkspacePlan(createWorkspacePlanRequestFixture());
    expect(
      workspacePlanSchema.safeParse({
        ...plan,
        metadata: { ...plan.metadata, totalBytes: plan.metadata.totalBytes + 1 },
      }).success,
    ).toBe(false);
    expect(
      workspacePlanSchema.safeParse({
        ...plan,
        files: [...plan.files].reverse(),
      }).success,
    ).toBe(false);

    const files = plan.files.map((file) => ({
      path: file.path,
      encoding: file.encoding,
      mediaType: file.mediaType,
      purpose: file.purpose,
      byteLength: file.byteLength,
      contentHash: file.contentHash,
      structuralHash: file.structuralHash,
    }));
    const invalidResult = {
      workspaceId: plan.workspaceId,
      source: plan.source,
      files,
      metadata: { ...plan.metadata, workspaceHash: 'e'.repeat(64) },
      lineage: { ...plan.lineage, workspaceHash: 'e'.repeat(64) },
      provenance: {
        workspaceVersion: plan.metadata.workspaceVersion,
        contractVersion: plan.metadata.contractVersion,
        sourceBundleVersion: plan.source.bundleVersion,
        sourceContractVersion: plan.source.contractVersion,
        adapter: 'FILESYSTEM',
        policyHash: plan.metadata.policyHash,
        configurationHash: plan.metadata.configurationHash,
        fileCount: plan.metadata.fileCount,
        totalBytes: plan.metadata.totalBytes,
      },
    };
    expect(workspaceMaterializationResultSchema.safeParse(invalidResult).success).toBe(false);
  });

  it('reports cross-file path and absolute bundle violations at the schema boundary', () => {
    const request = createWorkspacePlanRequestFixture();
    const first = request.files[0];
    if (first === undefined) throw new Error('Fixture file missing.');
    expect(
      workspacePlanRequestSchema.safeParse({
        ...request,
        files: [first, { ...first }],
      }).success,
    ).toBe(false);
    expect(
      workspacePlanRequestSchema.safeParse({
        ...request,
        files: [{ ...first, path: '../outside.ts' }],
      }).success,
    ).toBe(false);
    const content = 'x'.repeat(64 * 1024);
    const oversizedFiles = Array.from({ length: 7 }, (_, index) => ({
      ...first,
      path: `src/file-${index}.ts`,
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
    }));
    expect(
      workspacePlanRequestSchema.safeParse({ ...request, files: oversizedFiles }).success,
    ).toBe(false);
  });

  it('rejects a fully rehashed plan with an unsafe path or portable collision', () => {
    const plan = createWorkspacePlan(createWorkspacePlanRequestFixture());
    const first = plan.files[0];
    if (first === undefined) throw new Error('Plan file missing.');
    const unsafe = rehashPlan(plan, [{ ...first, path: '../outside.json' }]);
    expect(workspacePlanSchema.safeParse(unsafe).success).toBe(false);

    const collision = rehashPlan(plan, [
      { ...first, path: 'src/File.json' },
      { ...first, path: 'src/file.json' },
    ]);
    expect(workspacePlanSchema.safeParse(collision).success).toBe(false);
  });

  it('rejects a fully rehashed plan whose textual bundle exceeds 384 KiB', () => {
    const plan = createWorkspacePlan(createWorkspacePlanRequestFixture());
    const first = plan.files[0];
    if (first === undefined) throw new Error('Plan file missing.');
    const content = 'x'.repeat(64 * 1024);
    const oversized = rehashPlan(
      plan,
      Array.from({ length: 7 }, (_, index) => ({
        ...first,
        path: `src/file-${index}.json`,
        content,
      })),
    );
    expect(workspacePlanSchema.safeParse(oversized).success).toBe(false);
  });

  it('rejects fully rehashed materialization results with unsafe paths and oversized metadata', () => {
    const plan = createWorkspacePlan(createWorkspacePlanRequestFixture());
    const first = plan.files[0];
    if (first === undefined) throw new Error('Plan file missing.');

    const unsafeResult = resultFromRehashedPlan(
      rehashPlan(plan, [{ ...first, path: '/absolute.json' }]),
    );
    expect(workspaceMaterializationResultSchema.safeParse(unsafeResult).success).toBe(false);

    const content = 'x'.repeat(64 * 1024);
    const oversizedResult = resultFromRehashedPlan(
      rehashPlan(
        plan,
        Array.from({ length: 7 }, (_, index) => ({
          ...first,
          path: `src/file-${index}.json`,
          content,
        })),
      ),
    );
    expect(workspaceMaterializationResultSchema.safeParse(oversizedResult).success).toBe(false);
  });

  it('rejects a result whose structural hash or canonical ordering was tampered', () => {
    const plan = createWorkspacePlan(createWorkspacePlanRequestFixture());
    const result = resultFromRehashedPlan(rehashPlan(plan, plan.files));
    const first = result.files[0];
    if (first === undefined) throw new Error('Result file missing.');
    expect(
      workspaceMaterializationResultSchema.safeParse({
        ...result,
        files: [{ ...first, structuralHash: 'f'.repeat(64) }, ...result.files.slice(1)],
      }).success,
    ).toBe(false);
    expect(
      workspaceMaterializationResultSchema.safeParse({
        ...result,
        files: [...result.files].reverse(),
      }).success,
    ).toBe(false);
  });

  it('keeps the release result metadata-only and strict', () => {
    const plan = createWorkspacePlan(createWorkspacePlanRequestFixture());
    const materialized = resultFromRehashedPlan(rehashPlan(plan, plan.files));
    const release = {
      workspaceId: materialized.workspaceId,
      status: 'RELEASED',
      planHash: materialized.metadata.planHash,
      workspaceHash: materialized.metadata.workspaceHash,
    };

    expect(workspaceReleaseResultSchema.safeParse(release).success).toBe(true);
    expect(
      workspaceReleaseResultSchema.safeParse({ ...release, rootPath: '/private/workspace' })
        .success,
    ).toBe(false);
    expect(
      workspaceReleaseResultSchema.safeParse({ ...release, workspaceHash: 'invalid' }).success,
    ).toBe(false);
  });
});
