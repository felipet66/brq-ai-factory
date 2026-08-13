import { AsyncLocalStorage } from 'node:async_hooks';

import {
  approvePreviewArtifact,
  createPreviewArtifactCandidate,
  previewArtifactExportEnvelopeSchema,
  type PreviewArtifactCandidate,
  type PreviewArtifactContentStore,
  type PreviewArtifactDescriptor,
} from '@brq/preview-artifact';
import type { PreviewArtifactMetadataRepository } from '@brq/execution-repository';
import type { FactoryPipelineCoordinator } from '@brq/factory-pipeline';
import type {
  DockerSandboxArtifactSink,
  DockerSandboxCapturedArtifact,
  DockerSandboxUnavailableArtifact,
} from '@brq/sandbox-runner/docker';

const DEFAULT_ARTIFACT_RETENTION_MS = 60 * 60 * 1000;

export interface FactoryPreviewArtifactIntegration {
  readonly artifactSink: DockerSandboxArtifactSink;
  decorate(pipeline: FactoryPipelineCoordinator): FactoryPipelineCoordinator;
}

interface CreateFactoryPreviewArtifactIntegrationOptions {
  readonly store: PreviewArtifactContentStore;
  readonly metadataRepository: PreviewArtifactMetadataRepository;
  readonly sandboxPolicyId: string;
  readonly now?: () => number;
  readonly artifactRetentionMs?: number;
}

function timestamp(now: () => number): string {
  const observed = now();
  if (!Number.isFinite(observed) || observed < 0) throw new TypeError('Fonte temporal inválida.');
  return new Date(Math.round(observed)).toISOString();
}

export function createPersistentPreviewArtifactStore(options: {
  readonly store: PreviewArtifactContentStore;
  readonly metadataRepository: PreviewArtifactMetadataRepository;
}): PreviewArtifactContentStore {
  const persist = async (descriptor: PreviewArtifactDescriptor) =>
    options.metadataRepository.saveArtifactMetadata(descriptor);
  const rollbackPhysicalContent = async (
    artifactId: string,
    observedAt: string,
    primaryError: unknown,
    storeOptions: Parameters<PreviewArtifactContentStore['remove']>[2],
  ): Promise<never> => {
    try {
      await options.store.remove(artifactId, observedAt, storeOptions);
    } catch (cleanupError) {
      throw new AggregateError(
        [primaryError, cleanupError],
        'A persistência e o rollback do PreviewArtifact falharam.',
      );
    }
    throw primaryError;
  };
  const persistentStore: PreviewArtifactContentStore = {
    async stage(candidate, storeOptions) {
      const descriptor = await options.store.stage(candidate, storeOptions);
      try {
        await persist(descriptor);
        return descriptor;
      } catch (error) {
        return rollbackPhysicalContent(
          candidate.artifactId,
          candidate.createdAt,
          error,
          storeOptions,
        );
      }
    },
    async approve(artifact, storeOptions) {
      const approvedAt = artifact.approval?.approvedAt;
      if (approvedAt === undefined) {
        throw new TypeError('O PreviewArtifact aprovado não contém approval metadata.');
      }
      const descriptor = await options.store.approve(artifact, storeOptions);
      try {
        await persist(descriptor);
        return descriptor;
      } catch (error) {
        return rollbackPhysicalContent(artifact.artifactId, approvedAt, error, storeOptions);
      }
    },
    readApproved: (artifactId, storeOptions) =>
      options.store.readApproved(artifactId, storeOptions),
    async consume(artifactId, consumedAt, storeOptions) {
      const descriptor = await options.store.consume(artifactId, consumedAt, storeOptions);
      try {
        await persist(descriptor);
        return descriptor;
      } catch (error) {
        return rollbackPhysicalContent(artifactId, consumedAt, error, storeOptions);
      }
    },
    async expire(artifactId, expiredAt, storeOptions) {
      const descriptor = await options.store.expire(artifactId, expiredAt, storeOptions);
      try {
        await persist(descriptor);
        return descriptor;
      } catch (error) {
        return rollbackPhysicalContent(artifactId, expiredAt, error, storeOptions);
      }
    },
    async remove(artifactId, deletedAt, storeOptions) {
      const descriptor = await options.store.remove(artifactId, deletedAt, storeOptions);
      if (descriptor !== null) await persist(descriptor);
      return descriptor;
    },
  };
  return Object.freeze(persistentStore);
}

export function createFactoryPreviewArtifactIntegration(
  options: CreateFactoryPreviewArtifactIntegrationOptions,
): FactoryPreviewArtifactIntegration {
  const now = options.now ?? Date.now;
  const retention = options.artifactRetentionMs ?? DEFAULT_ARTIFACT_RETENTION_MS;
  if (!Number.isInteger(retention) || retention < 60_000 || retention > 24 * 60 * 60 * 1000) {
    throw new TypeError('A retenção efêmera do PreviewArtifact é inválida.');
  }
  const store = createPersistentPreviewArtifactStore(options);
  const candidates = new Map<string, PreviewArtifactCandidate>();
  const executionScope = new AsyncLocalStorage<Set<string>>();
  const expirations = new Map<string, PreviewArtifactCandidate>();
  let expirationTimer: ReturnType<typeof setTimeout> | undefined;

  const cleanupArtifact = async (candidate: PreviewArtifactCandidate): Promise<void> => {
    expirations.delete(candidate.artifactId);
    const observedAt = timestamp(now);
    try {
      await store.expire(candidate.artifactId, observedAt);
    } catch {
      // The artifact may already be consumed or terminal; removal remains authoritative.
    }
    try {
      await store.remove(candidate.artifactId, observedAt);
    } catch {
      // Startup reconciliation and access-time validation remain fail-closed fallbacks.
    }
  };

  const armExpirationTimer = (): void => {
    if (expirationTimer !== undefined) clearTimeout(expirationTimer);
    expirationTimer = undefined;
    const next = [...expirations.values()].sort(
      (left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt),
    )[0];
    if (next === undefined) return;
    const delay = Math.max(0, Date.parse(next.expiresAt) - now());
    expirationTimer = setTimeout(() => {
      expirationTimer = undefined;
      const observed = now();
      const due = [...expirations.values()].filter(
        (candidate) => Date.parse(candidate.expiresAt) <= observed,
      );
      void Promise.allSettled(due.map((candidate) => cleanupArtifact(candidate))).finally(
        armExpirationTimer,
      );
    }, delay);
    expirationTimer.unref?.();
  };

  const scheduleExpiration = (candidate: PreviewArtifactCandidate): void => {
    expirations.set(candidate.artifactId, candidate);
    armExpirationTimer();
  };

  const removeCandidate = async (executionId: string): Promise<void> => {
    const candidate = candidates.get(executionId);
    candidates.delete(executionId);
    if (candidate === undefined) return;
    expirations.delete(candidate.artifactId);
    try {
      await store.remove(candidate.artifactId, timestamp(now));
    } catch {
      // Preview artifact cleanup is additive and never rewrites the authoritative Factory result.
    }
  };

  const captured = async (input: DockerSandboxCapturedArtifact): Promise<void> => {
    if (input.policyId !== options.sandboxPolicyId) {
      throw new TypeError('O artifact foi exportado por uma Sandbox policy não aprovada.');
    }
    const envelope = previewArtifactExportEnvelopeSchema.parse(
      JSON.parse(input.envelope) as unknown,
    );
    const createdAt = timestamp(now);
    const candidate = createPreviewArtifactCandidate({
      executionId: input.executionId,
      workspaceHash: input.workspaceHash,
      sandboxRequestHash: input.sandboxRequestHash,
      profileId: envelope.profileId,
      exporterVersion: envelope.exporterVersion,
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + retention).toISOString(),
      files: envelope.files,
    });
    await store.stage(candidate);
    candidates.set(input.executionId, candidate);
    executionScope.getStore()?.add(input.executionId);
  };

  const unavailable = async (input: DockerSandboxUnavailableArtifact): Promise<void> => {
    await removeCandidate(input.executionId);
  };

  const integration: FactoryPreviewArtifactIntegration = {
    artifactSink: Object.freeze({ captured, unavailable }),
    decorate(pipeline) {
      const decorated: FactoryPipelineCoordinator = {
        ...(pipeline.preflight === undefined
          ? {}
          : {
              preflight: pipeline.preflight.bind(pipeline),
            }),
        async execute(request, runOptions) {
          return executionScope.run(new Set<string>(), async () => {
            const scopedExecutionIds = executionScope.getStore()!;
            try {
              const result = await pipeline.execute(request, runOptions);
              const candidate = candidates.get(result.executionId);
              try {
                if (
                  candidate !== undefined &&
                  result.status === 'SUCCESS' &&
                  result.sandbox.status === 'SUCCESS' &&
                  result.workspace.releaseStatus === 'RELEASED' &&
                  result.hashes.workspaceHash === candidate.source.workspaceHash &&
                  result.hashes.sandboxRequestHash === candidate.source.sandboxRequestHash &&
                  result.hashes.sandboxResultHash !== null
                ) {
                  const approved = approvePreviewArtifact({
                    candidate,
                    factoryStatus: 'SUCCESS',
                    sandboxStatus: 'SUCCESS',
                    workspaceReleaseStatus: 'RELEASED',
                    factoryResultHash: result.hashes.factoryResultHash,
                    sandboxResultHash: result.hashes.sandboxResultHash,
                    sandboxRequestHash: result.hashes.sandboxRequestHash,
                    workspaceHash: result.hashes.workspaceHash,
                    approvedAt: timestamp(now),
                  });
                  await store.approve(approved);
                  candidates.delete(result.executionId);
                  scheduleExpiration(candidate);
                } else {
                  await removeCandidate(result.executionId);
                }
              } catch {
                await removeCandidate(result.executionId);
              }
              for (const executionId of scopedExecutionIds) {
                if (executionId !== result.executionId) await removeCandidate(executionId);
              }
              return result;
            } catch (error) {
              await Promise.allSettled(
                [...scopedExecutionIds].map((executionId) => removeCandidate(executionId)),
              );
              throw error;
            }
          });
        },
      };
      return Object.freeze(decorated);
    },
  };
  return Object.freeze(integration);
}
