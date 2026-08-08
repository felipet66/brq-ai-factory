import path from 'node:path';

import type {
  ControlledWorkspace,
  CreateFilesystemControlledWorkspaceOptions,
  WorkspaceMaterializationResult,
  WorkspacePlan,
  WorkspacePlanRequest,
} from '../contracts';
import { resolveControlledWorkspaceLimits } from '../configuration';
import {
  CONTROLLED_WORKSPACE_ERROR_CODES,
  CONTROLLED_WORKSPACE_ERROR_STAGES,
  ControlledWorkspaceError,
} from '../errors';
import { calculateMaterializedWorkspaceHash } from '../hashing';
import { immutableClone } from '../immutability';
import { workspaceMaterializationResultSchema, workspacePlanSchema } from '../schemas';
import { createWorkspacePlan } from '../workspace-planner';
import { materializeWorkspaceAtomically } from './atomic-materializer';
import type { WorkspaceFileSystem } from './file-system';

interface FilesystemControlledWorkspaceDependencies {
  readonly fileSystem: WorkspaceFileSystem;
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
  const now = options.now ?? Date.now;
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
    materialize: async (inputPlan: WorkspacePlan) => {
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
        await materializeWorkspaceAtomically(workspacePlan, rootPath, dependencies.fileSystem);
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
  });
}
