import {
  createInMemoryPreviewArtifactContentStore,
  type ApprovedPreviewArtifact,
  type PreviewArtifactDescriptor,
} from '@brq/preview-artifact';
import {
  createApprovedPreviewArtifactFixture,
  createPreviewArtifactCandidateFixture,
  createPreviewArtifactFilesFixture,
} from '@brq/preview-artifact/testing';
import type { PreviewArtifactMetadataRepository } from '@brq/execution-repository';
import { createFactoryExecutionResultFixture } from '@brq/factory-pipeline/testing';
import { describe, expect, it, vi } from 'vitest';

import {
  createFactoryPreviewArtifactIntegration,
  createPersistentPreviewArtifactStore,
} from './artifact-integration';

describe('Factory Preview Artifact integration', () => {
  it('stages post-TEST content and approves it only after correlated Factory SUCCESS', async () => {
    const result = createFactoryExecutionResultFixture();
    const descriptors: PreviewArtifactDescriptor[] = [];
    const metadataRepository = {
      saveArtifactMetadata: vi.fn(async (descriptor: PreviewArtifactDescriptor) => {
        descriptors.push(descriptor);
        return descriptor;
      }),
      findArtifactMetadataByArtifactId: vi.fn(),
      findArtifactMetadataByExecutionId: vi.fn(),
    } satisfies PreviewArtifactMetadataRepository;
    const store = createInMemoryPreviewArtifactContentStore();
    const nowValues = [
      Date.parse('2026-08-10T12:00:00.000Z'),
      Date.parse('2026-08-10T12:00:10.000Z'),
    ];
    const integration = createFactoryPreviewArtifactIntegration({
      store,
      metadataRepository,
      sandboxPolicyId: 'NODE_NONE_24_V1',
      now: () => nowValues.shift() ?? Date.parse('2026-08-10T12:00:10.000Z'),
    });
    const pipeline = integration.decorate({
      async execute() {
        await integration.artifactSink.captured({
          executionId: result.executionId,
          workspaceId: result.workspace.workspaceId!,
          workspaceHash: result.hashes.workspaceHash!,
          policyId: 'NODE_NONE_24_V1',
          sandboxRequestHash: result.hashes.sandboxRequestHash!,
          envelope: JSON.stringify({
            abiVersion: '1.0.0',
            profileId: 'NODE_WEB_PREVIEW_24_V1',
            exporterVersion: '1.0.0',
            files: createPreviewArtifactFilesFixture(),
          }),
        });
        return result;
      },
    });

    await expect(pipeline.execute({} as never)).resolves.toEqual(result);
    expect(descriptors.map((descriptor) => descriptor.status)).toEqual(['CANDIDATE', 'APPROVED']);
    expect(descriptors.at(-1)).toMatchObject({
      source: {
        executionId: result.executionId,
        workspaceHash: result.hashes.workspaceHash,
        sandboxRequestHash: result.hashes.sandboxRequestHash,
      },
      approval: {
        factoryResultHash: result.hashes.factoryResultHash,
        sandboxResultHash: result.hashes.sandboxResultHash,
      },
    });
  });

  it('rejects an artifact exported under another Sandbox policy', async () => {
    const integration = createFactoryPreviewArtifactIntegration({
      store: createInMemoryPreviewArtifactContentStore(),
      metadataRepository: {
        saveArtifactMetadata: vi.fn(),
        findArtifactMetadataByArtifactId: vi.fn(),
        findArtifactMetadataByExecutionId: vi.fn(),
      },
      sandboxPolicyId: 'NODE_NONE_24_V1',
    });
    await expect(
      integration.artifactSink.captured({
        executionId: 'execution-factory-fixture-001',
        workspaceId: `workspace-${'1'.repeat(32)}`,
        workspaceHash: 'a'.repeat(64),
        sandboxRequestHash: 'b'.repeat(64),
        policyId: 'ANOTHER_POLICY',
        envelope: '{}',
      }),
    ).rejects.toThrow('Sandbox policy não aprovada');
  });

  it('removes the staged artifact instead of approving it when the Factory is not successful', async () => {
    const result = createFactoryExecutionResultFixture();
    const descriptors: PreviewArtifactDescriptor[] = [];
    const integration = createFactoryPreviewArtifactIntegration({
      store: createInMemoryPreviewArtifactContentStore(),
      metadataRepository: {
        saveArtifactMetadata: vi.fn(async (descriptor: PreviewArtifactDescriptor) => {
          descriptors.push(descriptor);
          return descriptor;
        }),
        findArtifactMetadataByArtifactId: vi.fn(),
        findArtifactMetadataByExecutionId: vi.fn(),
      },
      sandboxPolicyId: 'NODE_NONE_24_V1',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
    });
    const pipeline = integration.decorate({
      async execute() {
        await integration.artifactSink.captured({
          executionId: result.executionId,
          workspaceId: result.workspace.workspaceId!,
          workspaceHash: result.hashes.workspaceHash!,
          policyId: 'NODE_NONE_24_V1',
          sandboxRequestHash: result.hashes.sandboxRequestHash!,
          envelope: JSON.stringify({
            abiVersion: '1.0.0',
            profileId: 'NODE_WEB_PREVIEW_24_V1',
            exporterVersion: '1.0.0',
            files: createPreviewArtifactFilesFixture(),
          }),
        });
        return { ...result, status: 'FAILED' } as never;
      },
    });

    await expect(pipeline.execute({} as never)).resolves.toMatchObject({ status: 'FAILED' });
    expect(descriptors.map((descriptor) => descriptor.status)).toEqual(['CANDIDATE', 'DELETED']);
    expect(descriptors).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'APPROVED' })]),
    );
  });

  it('rolls back ephemeral content when staging metadata cannot be persisted', async () => {
    const contentStore = createInMemoryPreviewArtifactContentStore();
    const persistentStore = createPersistentPreviewArtifactStore({
      store: contentStore,
      metadataRepository: {
        saveArtifactMetadata: vi.fn(async () => Promise.reject(new Error('metadata unavailable'))),
        findArtifactMetadataByArtifactId: vi.fn(),
        findArtifactMetadataByExecutionId: vi.fn(),
      },
    });
    const candidate = createPreviewArtifactCandidateFixture();
    const approved = createApprovedPreviewArtifactFixture();

    await expect(persistentStore.stage(candidate)).rejects.toThrow('metadata unavailable');
    await expect(contentStore.approve(approved)).rejects.toBeDefined();
  });

  it('surfaces an unconfirmed physical rollback instead of swallowing the cleanup failure', async () => {
    const contentStore = createInMemoryPreviewArtifactContentStore();
    const persistentStore = createPersistentPreviewArtifactStore({
      store: {
        ...contentStore,
        remove: vi.fn(async () => Promise.reject(new Error('physical cleanup failed'))),
      },
      metadataRepository: {
        saveArtifactMetadata: vi.fn(async () => Promise.reject(new Error('metadata unavailable'))),
        findArtifactMetadataByArtifactId: vi.fn(),
        findArtifactMetadataByExecutionId: vi.fn(),
      },
    });

    await expect(
      persistentStore.stage(createPreviewArtifactCandidateFixture()),
    ).rejects.toMatchObject({
      name: 'AggregateError',
      message: 'A persistência e o rollback do PreviewArtifact falharam.',
    });
  });

  it('removes approved content when the corresponding metadata transition cannot be persisted', async () => {
    const contentStore = createInMemoryPreviewArtifactContentStore();
    let persistenceCalls = 0;
    const persistentStore = createPersistentPreviewArtifactStore({
      store: contentStore,
      metadataRepository: {
        saveArtifactMetadata: vi.fn(async (descriptor: PreviewArtifactDescriptor) => {
          persistenceCalls += 1;
          if (persistenceCalls === 2) throw new Error('approval metadata unavailable');
          return descriptor;
        }),
        findArtifactMetadataByArtifactId: vi.fn(),
        findArtifactMetadataByExecutionId: vi.fn(),
      },
    });
    const candidate = createPreviewArtifactCandidateFixture();
    const approved = createApprovedPreviewArtifactFixture();

    await persistentStore.stage(candidate);
    await expect(persistentStore.approve(approved)).rejects.toThrow(
      'approval metadata unavailable',
    );
    await expect(contentStore.readApproved(candidate.artifactId)).resolves.toBeNull();
  });

  it('fails closed before storage when approval metadata is missing', async () => {
    const contentStore = createInMemoryPreviewArtifactContentStore();
    const approve = vi.fn(contentStore.approve);
    const persistentStore = createPersistentPreviewArtifactStore({
      store: { ...contentStore, approve },
      metadataRepository: {
        saveArtifactMetadata: vi.fn(),
        findArtifactMetadataByArtifactId: vi.fn(),
        findArtifactMetadataByExecutionId: vi.fn(),
      },
    });
    const tampered = {
      ...createApprovedPreviewArtifactFixture(),
      approval: null,
    } as unknown as ApprovedPreviewArtifact;

    await expect(persistentStore.approve(tampered)).rejects.toThrow(
      'O PreviewArtifact aprovado não contém approval metadata.',
    );
    expect(approve).not.toHaveBeenCalled();
  });

  it('removes the scoped candidate when the Factory pipeline rejects', async () => {
    const result = createFactoryExecutionResultFixture();
    const descriptors: PreviewArtifactDescriptor[] = [];
    const integration = createFactoryPreviewArtifactIntegration({
      store: createInMemoryPreviewArtifactContentStore(),
      metadataRepository: {
        saveArtifactMetadata: vi.fn(async (descriptor: PreviewArtifactDescriptor) => {
          descriptors.push(descriptor);
          return descriptor;
        }),
        findArtifactMetadataByArtifactId: vi.fn(),
        findArtifactMetadataByExecutionId: vi.fn(),
      },
      sandboxPolicyId: 'NODE_NONE_24_V1',
      now: () => Date.parse('2026-08-10T12:00:00.000Z'),
    });
    const pipeline = integration.decorate({
      async execute() {
        await integration.artifactSink.captured({
          executionId: result.executionId,
          workspaceId: result.workspace.workspaceId!,
          workspaceHash: result.hashes.workspaceHash!,
          policyId: 'NODE_NONE_24_V1',
          sandboxRequestHash: result.hashes.sandboxRequestHash!,
          envelope: JSON.stringify({
            abiVersion: '1.0.0',
            profileId: 'NODE_WEB_PREVIEW_24_V1',
            exporterVersion: '1.0.0',
            files: createPreviewArtifactFilesFixture(),
          }),
        });
        throw new Error('pipeline rejected');
      },
    });

    await expect(pipeline.execute({} as never)).rejects.toThrow('pipeline rejected');
    expect(descriptors.map((descriptor) => descriptor.status)).toEqual(['CANDIDATE', 'DELETED']);
  });

  it('expires and removes an approved artifact that is never launched', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime('2026-08-10T12:00:00.000Z');
      const result = createFactoryExecutionResultFixture();
      const descriptors: PreviewArtifactDescriptor[] = [];
      const integration = createFactoryPreviewArtifactIntegration({
        store: createInMemoryPreviewArtifactContentStore(),
        metadataRepository: {
          saveArtifactMetadata: vi.fn(async (descriptor: PreviewArtifactDescriptor) => {
            descriptors.push(descriptor);
            return descriptor;
          }),
          findArtifactMetadataByArtifactId: vi.fn(),
          findArtifactMetadataByExecutionId: vi.fn(),
        },
        sandboxPolicyId: 'NODE_NONE_24_V1',
        now: Date.now,
        artifactRetentionMs: 60_000,
      });
      const pipeline = integration.decorate({
        async execute() {
          await integration.artifactSink.captured({
            executionId: result.executionId,
            workspaceId: result.workspace.workspaceId!,
            workspaceHash: result.hashes.workspaceHash!,
            policyId: 'NODE_NONE_24_V1',
            sandboxRequestHash: result.hashes.sandboxRequestHash!,
            envelope: JSON.stringify({
              abiVersion: '1.0.0',
              profileId: 'NODE_WEB_PREVIEW_24_V1',
              exporterVersion: '1.0.0',
              files: createPreviewArtifactFilesFixture(),
            }),
          });
          return result;
        },
      });

      await pipeline.execute({} as never);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(descriptors.map((descriptor) => descriptor.status)).toEqual([
        'CANDIDATE',
        'APPROVED',
        'EXPIRED',
        'DELETED',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
