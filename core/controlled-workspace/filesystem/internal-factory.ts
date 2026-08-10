import path from 'node:path';

import type {
  ControlledWorkspace,
  CreateFilesystemControlledWorkspaceOptions,
  WorkspaceMaterializationOptions,
  WorkspaceMaterializationResult,
  WorkspacePlan,
  WorkspacePlanRequest,
  WorkspaceReleaseResult,
} from '../contracts';
import { resolveControlledWorkspaceLimits } from '../configuration';
import {
  CONTROLLED_WORKSPACE_ERROR_CODES,
  CONTROLLED_WORKSPACE_ERROR_STAGES,
  ControlledWorkspaceError,
} from '../errors';
import { calculateMaterializedWorkspaceHash } from '../hashing';
import { immutableClone } from '../immutability';
import { resolveControlledWorkspaceCleanupTimeout } from '../lifecycle';
import {
  workspaceMaterializationResultSchema,
  workspacePlanSchema,
  workspaceReleaseResultSchema,
} from '../schemas';
import { createWorkspacePlan } from '../workspace-planner';
import {
  materializeWorkspaceAtomically,
  verifyOwnedMaterializedWorkspace,
  type MaterializedWorkspaceOwnership,
} from './atomic-materializer';
import { removeWorkspaceWithDeadline } from './cleanup';
import type { WorkspaceFileSystem } from './file-system';

interface FilesystemControlledWorkspaceDependencies {
  readonly fileSystem: WorkspaceFileSystem;
}

interface OwnedWorkspace {
  readonly ownership: MaterializedWorkspaceOwnership;
  readonly result: WorkspaceMaterializationResult;
  releasePromise?: Promise<WorkspaceReleaseResult>;
}

function emitLogSafely(operation: (() => void) | undefined): void {
  if (operation === undefined) return;
  try {
    operation();
  } catch {
    // Observability is best effort and never changes workspace outcomes.
  }
}

function validateRootPath(rootPath: string): string {
  if (
    rootPath.length === 0 ||
    rootPath.trim() !== rootPath ||
    rootPath.includes('\u0000') ||
    !path.isAbsolute(rootPath) ||
    rootPath !== path.resolve(rootPath) ||
    rootPath === path.parse(rootPath).root
  ) {
    throw new ControlledWorkspaceError('A raiz do workspace controlado é inválida.', {
      code: CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_CONFIGURATION,
      stage: CONTROLLED_WORKSPACE_ERROR_STAGES.CONFIGURATION,
    });
  }
  return rootPath;
}

export function createFilesystemControlledWorkspaceWithDependencies(
  options: CreateFilesystemControlledWorkspaceOptions,
  dependencies: FilesystemControlledWorkspaceDependencies,
): ControlledWorkspace {
  const rootPath = validateRootPath(options.rootPath);
  const limits = resolveControlledWorkspaceLimits(options.limits);
  const cleanupTimeoutMs = resolveControlledWorkspaceCleanupTimeout(options.cleanupTimeoutMs);
  const now = options.now ?? Date.now;
  const ownedWorkspaces = new Map<string, OwnedWorkspace>();
  const plan = (request: WorkspacePlanRequest) => {
    const startedAt = now();
    const createdPlan = createWorkspacePlan(request, { limits });
    emitLogSafely(
      options.logger === undefined
        ? undefined
        : () =>
            options.logger?.info('controlled_workspace.plan.created', {
              workspaceId: createdPlan.workspaceId,
              planHash: createdPlan.metadata.planHash,
              policyHash: createdPlan.metadata.policyHash,
              configurationHash: createdPlan.metadata.configurationHash,
              bundleHash: createdPlan.source.bundleHash,
              bundleContentHash: createdPlan.source.bundleContentHash,
              fileCount: createdPlan.metadata.fileCount,
              totalBytes: createdPlan.metadata.totalBytes,
              durationMs: Math.max(0, now() - startedAt),
            }),
    );
    return createdPlan;
  };

  return Object.freeze({
    plan,
    materialize: async (
      inputPlan: WorkspacePlan,
      materializationOptions?: WorkspaceMaterializationOptions,
    ) => {
      const startedAt = now();
      let workspaceId: string | undefined;
      try {
        const parsedPlan = workspacePlanSchema.safeParse(inputPlan);
        if (!parsedPlan.success) {
          throw new ControlledWorkspaceError(
            'O plano fornecido não corresponde ao contrato ou aos hashes declarados.',
            {
              code: CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_REQUEST,
              stage: CONTROLLED_WORKSPACE_ERROR_STAGES.REQUEST_VALIDATION,
            },
          );
        }
        const authorizedPlan = createWorkspacePlan(
          {
            source: parsedPlan.data.source,
            files: parsedPlan.data.files.map((file) => ({
              path: file.path,
              content: file.content,
              encoding: file.encoding,
              mediaType: file.mediaType,
              purpose: file.purpose,
              byteLength: file.byteLength,
              contentHash: file.contentHash,
            })),
          },
          { limits },
        );
        if (authorizedPlan.metadata.planHash !== parsedPlan.data.metadata.planHash) {
          throw new ControlledWorkspaceError(
            'O plano fornecido não corresponde à autorização recalculada.',
            {
              code: CONTROLLED_WORKSPACE_ERROR_CODES.VERIFICATION_FAILED,
              stage: CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION,
              workspaceId: parsedPlan.data.workspaceId,
            },
          );
        }
        const workspacePlan = immutableClone(parsedPlan.data);
        workspaceId = workspacePlan.workspaceId;
        const files = workspacePlan.files.map((file) => ({
          path: file.path,
          encoding: file.encoding,
          mediaType: file.mediaType,
          purpose: file.purpose,
          byteLength: file.byteLength,
          contentHash: file.contentHash,
          structuralHash: file.structuralHash,
        }));
        const workspaceHash = calculateMaterializedWorkspaceHash({
          workspaceId,
          planHash: workspacePlan.metadata.planHash,
          source: workspacePlan.source,
          files,
          policyHash: workspacePlan.metadata.policyHash,
          configurationHash: workspacePlan.metadata.configurationHash,
        });
        const candidate: WorkspaceMaterializationResult = {
          workspaceId,
          source: workspacePlan.source,
          files,
          metadata: { ...workspacePlan.metadata, workspaceHash },
          lineage: { ...workspacePlan.lineage, workspaceHash },
          provenance: {
            workspaceVersion: workspacePlan.metadata.workspaceVersion,
            contractVersion: workspacePlan.metadata.contractVersion,
            sourceBundleVersion: workspacePlan.source.bundleVersion,
            sourceContractVersion: workspacePlan.source.contractVersion,
            adapter: 'FILESYSTEM',
            policyHash: workspacePlan.metadata.policyHash,
            configurationHash: workspacePlan.metadata.configurationHash,
            fileCount: workspacePlan.metadata.fileCount,
            totalBytes: workspacePlan.metadata.totalBytes,
          },
        };
        const parsed = workspaceMaterializationResultSchema.safeParse(candidate);
        if (!parsed.success) {
          throw new ControlledWorkspaceError(
            'O resultado materializado não corresponde ao contrato público.',
            {
              code: CONTROLLED_WORKSPACE_ERROR_CODES.VERIFICATION_FAILED,
              stage: CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION,
              workspaceId,
            },
          );
        }
        const result = immutableClone(parsed.data);
        emitLogSafely(
          options.logger === undefined
            ? undefined
            : () =>
                options.logger?.info('controlled_workspace.materialization.started', {
                  workspaceId,
                  planHash: workspacePlan.metadata.planHash,
                  bundleHash: workspacePlan.source.bundleHash,
                  fileCount: workspacePlan.metadata.fileCount,
                  totalBytes: workspacePlan.metadata.totalBytes,
                }),
        );
        const ownership = await materializeWorkspaceAtomically(
          workspacePlan,
          rootPath,
          {
            cleanupTimeoutMs,
            ...(materializationOptions?.signal === undefined
              ? {}
              : { signal: materializationOptions.signal }),
          },
          dependencies.fileSystem,
        );
        ownedWorkspaces.set(workspaceId, { ownership, result });
        emitLogSafely(
          options.logger === undefined
            ? undefined
            : () =>
                options.logger?.info('controlled_workspace.materialization.completed', {
                  workspaceId,
                  planHash: result.metadata.planHash,
                  workspaceHash: result.metadata.workspaceHash,
                  fileCount: result.metadata.fileCount,
                  totalBytes: result.metadata.totalBytes,
                  durationMs: Math.max(0, now() - startedAt),
                }),
        );
        return result;
      } catch (error) {
        const controlledError =
          error instanceof ControlledWorkspaceError
            ? error
            : new ControlledWorkspaceError('Não foi possível materializar o workspace.', {
                code: CONTROLLED_WORKSPACE_ERROR_CODES.MATERIALIZATION_FAILED,
                stage: CONTROLLED_WORKSPACE_ERROR_STAGES.MATERIALIZATION,
                ...(workspaceId === undefined ? {} : { workspaceId }),
              });
        emitLogSafely(
          options.logger === undefined
            ? undefined
            : () =>
                options.logger?.error('controlled_workspace.materialization.failed', {
                  workspaceId,
                  durationMs: Math.max(0, now() - startedAt),
                  error: { code: controlledError.code, stage: controlledError.stage },
                }),
        );
        throw controlledError;
      }
    },
    release: async (inputResult: WorkspaceMaterializationResult) => {
      const parsed = workspaceMaterializationResultSchema.safeParse(inputResult);
      if (!parsed.success) {
        throw new ControlledWorkspaceError(
          'O resultado fornecido para release não corresponde ao contrato público.',
          {
            code: CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_REQUEST,
            stage: CONTROLLED_WORKSPACE_ERROR_STAGES.REQUEST_VALIDATION,
          },
        );
      }
      const releaseInput = immutableClone(parsed.data);
      const owned = ownedWorkspaces.get(releaseInput.workspaceId);
      if (
        owned === undefined ||
        owned.result.metadata.planHash !== releaseInput.metadata.planHash ||
        owned.result.metadata.workspaceHash !== releaseInput.metadata.workspaceHash ||
        owned.result.source.bundleHash !== releaseInput.source.bundleHash ||
        owned.result.source.bundleContentHash !== releaseInput.source.bundleContentHash ||
        owned.result.source.technicalSpecificationHash !==
          releaseInput.source.technicalSpecificationHash
      ) {
        throw new ControlledWorkspaceError(
          'O workspace não pertence a esta instância controlada.',
          {
            code: CONTROLLED_WORKSPACE_ERROR_CODES.WORKSPACE_NOT_OWNED,
            stage: CONTROLLED_WORKSPACE_ERROR_STAGES.CLEANUP,
            workspaceId: releaseInput.workspaceId,
          },
        );
      }
      if (owned.releasePromise !== undefined) return owned.releasePromise;

      owned.releasePromise = (async () => {
        const startedAt = now();
        emitLogSafely(
          options.logger === undefined
            ? undefined
            : () =>
                options.logger?.info('controlled_workspace.release.started', {
                  workspaceId: releaseInput.workspaceId,
                  planHash: releaseInput.metadata.planHash,
                  workspaceHash: releaseInput.metadata.workspaceHash,
                  fileCount: releaseInput.metadata.fileCount,
                  totalBytes: releaseInput.metadata.totalBytes,
                }),
        );
        try {
          let verificationFailure: ControlledWorkspaceError | undefined;
          try {
            await verifyOwnedMaterializedWorkspace(
              owned.ownership,
              releaseInput,
              dependencies.fileSystem,
            );
          } catch (error) {
            if (
              error instanceof ControlledWorkspaceError &&
              error.code === CONTROLLED_WORKSPACE_ERROR_CODES.WORKSPACE_NOT_OWNED
            ) {
              throw error;
            }
            verificationFailure =
              error instanceof ControlledWorkspaceError
                ? error
                : new ControlledWorkspaceError(
                    'Não foi possível verificar o workspace antes do cleanup.',
                    {
                      code: CONTROLLED_WORKSPACE_ERROR_CODES.VERIFICATION_FAILED,
                      stage: CONTROLLED_WORKSPACE_ERROR_STAGES.CLEANUP,
                      workspaceId: releaseInput.workspaceId,
                    },
                  );
          }

          await removeWorkspaceWithDeadline(
            dependencies.fileSystem,
            owned.ownership.destinationPath,
            cleanupTimeoutMs,
            releaseInput.workspaceId,
          );
          if (verificationFailure !== undefined) throw verificationFailure;

          const releaseCandidate = {
            workspaceId: releaseInput.workspaceId,
            status: 'RELEASED' as const,
            planHash: releaseInput.metadata.planHash,
            workspaceHash: releaseInput.metadata.workspaceHash,
          };
          const releaseResult = immutableClone(
            workspaceReleaseResultSchema.parse(releaseCandidate),
          );
          emitLogSafely(
            options.logger === undefined
              ? undefined
              : () =>
                  options.logger?.info('controlled_workspace.release.completed', {
                    workspaceId: releaseInput.workspaceId,
                    planHash: releaseInput.metadata.planHash,
                    workspaceHash: releaseInput.metadata.workspaceHash,
                    durationMs: Math.max(0, now() - startedAt),
                  }),
          );
          return releaseResult;
        } catch (error) {
          const controlledError =
            error instanceof ControlledWorkspaceError
              ? error
              : new ControlledWorkspaceError('Não foi possível liberar o workspace.', {
                  code: CONTROLLED_WORKSPACE_ERROR_CODES.CLEANUP_FAILED,
                  stage: CONTROLLED_WORKSPACE_ERROR_STAGES.CLEANUP,
                  workspaceId: releaseInput.workspaceId,
                });
          emitLogSafely(
            options.logger === undefined
              ? undefined
              : () =>
                  options.logger?.error('controlled_workspace.release.failed', {
                    workspaceId: releaseInput.workspaceId,
                    durationMs: Math.max(0, now() - startedAt),
                    error: { code: controlledError.code, stage: controlledError.stage },
                  }),
          );
          throw controlledError;
        }
      })();
      return owned.releasePromise;
    },
  });
}
