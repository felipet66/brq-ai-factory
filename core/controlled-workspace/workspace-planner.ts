import type {
  ControlledWorkspacePlanner,
  CreateControlledWorkspacePlannerOptions,
  WorkspacePlan,
  WorkspacePlanFile,
  WorkspacePlanRequest,
} from './contracts';
import { ContentSafetyFailure, assertSafeWorkspaceContent } from './content-safety';
import {
  CONTROLLED_WORKSPACE_ERROR_CODES,
  CONTROLLED_WORKSPACE_ERROR_STAGES,
  ControlledWorkspaceError,
} from './errors';
import {
  calculateWorkspaceContentHash,
  calculateWorkspaceConfigurationHash,
  calculateWorkspaceFileStructuralHash,
  calculateWorkspacePlanHash,
  calculateWorkspacePolicyHash,
  deriveWorkspaceId,
} from './hashing';
import { immutableClone } from './immutability';
import { CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS, type ControlledWorkspaceLimits } from './limits';
import { resolveControlledWorkspaceLimits } from './configuration';
import {
  CONTROLLED_WORKSPACE_MEDIA_TYPES,
  PathSafetyFailure,
  assertNoWorkspacePathCollisions,
  inspectSafeWorkspacePath,
} from './path-safety';
import { workspacePlanRequestSchema, workspacePlanSchema } from './schemas';
import {
  CONTROLLED_WORKSPACE_CONTRACT_VERSION,
  CONTROLLED_WORKSPACE_HASH_ALGORITHM,
  CONTROLLED_WORKSPACE_VERSION,
} from './version';

function sortPath(left: { readonly path: string }, right: { readonly path: string }): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function pathError(error: PathSafetyFailure): ControlledWorkspaceError {
  return new ControlledWorkspaceError('Um caminho do workspace foi rejeitado pela política.', {
    code: CONTROLLED_WORKSPACE_ERROR_CODES.UNSAFE_PATH,
    stage: CONTROLLED_WORKSPACE_ERROR_STAGES.PATH_VALIDATION,
    sourceCode: error.reason,
  });
}

function assertConfiguredLimits(
  request: WorkspacePlanRequest,
  limits: ControlledWorkspaceLimits,
): void {
  if (request.files.length > limits.maxFiles) {
    throw new ControlledWorkspaceError('A quantidade de arquivos excede o limite configurado.', {
      code: CONTROLLED_WORKSPACE_ERROR_CODES.LIMIT_EXCEEDED,
      stage: CONTROLLED_WORKSPACE_ERROR_STAGES.REQUEST_VALIDATION,
    });
  }

  let totalBytes = 0;
  const paths = [];
  for (const file of request.files) {
    const byteLength = Buffer.byteLength(file.content, 'utf8');
    totalBytes += byteLength;
    if (byteLength > limits.maxFileBytes) {
      throw new ControlledWorkspaceError('Um arquivo excede o limite configurado.', {
        code: CONTROLLED_WORKSPACE_ERROR_CODES.LIMIT_EXCEEDED,
        stage: CONTROLLED_WORKSPACE_ERROR_STAGES.REQUEST_VALIDATION,
      });
    }
    try {
      paths.push(inspectSafeWorkspacePath(file.path, file.mediaType, limits));
    } catch (error) {
      if (error instanceof PathSafetyFailure) throw pathError(error);
      throw error;
    }
  }
  if (totalBytes > limits.maxBundleBytes) {
    throw new ControlledWorkspaceError('O bundle excede o limite configurado.', {
      code: CONTROLLED_WORKSPACE_ERROR_CODES.LIMIT_EXCEEDED,
      stage: CONTROLLED_WORKSPACE_ERROR_STAGES.REQUEST_VALIDATION,
    });
  }
  try {
    assertNoWorkspacePathCollisions(paths);
  } catch (error) {
    if (error instanceof PathSafetyFailure) {
      throw new ControlledWorkspaceError(
        'Os caminhos colidem ou criam conflito entre arquivo e diretório.',
        {
          code: CONTROLLED_WORKSPACE_ERROR_CODES.PATH_COLLISION,
          stage: CONTROLLED_WORKSPACE_ERROR_STAGES.PATH_VALIDATION,
          sourceCode: error.reason,
        },
      );
    }
    throw error;
  }
}

function buildPlanFile(file: WorkspacePlanRequest['files'][number]): WorkspacePlanFile {
  const byteLength = Buffer.byteLength(file.content, 'utf8');
  const contentHash = calculateWorkspaceContentHash(file.content);
  const structuralHash = calculateWorkspaceFileStructuralHash({
    path: file.path,
    encoding: file.encoding,
    mediaType: file.mediaType,
    purpose: file.purpose,
    byteLength,
    contentHash,
  });
  return { ...file, structuralHash };
}

export function createWorkspacePlan(
  request: WorkspacePlanRequest,
  options: CreateControlledWorkspacePlannerOptions = {},
): WorkspacePlan {
  const limits = resolveControlledWorkspaceLimits(options.limits);
  if (request !== null && typeof request === 'object' && Array.isArray(request.files)) {
    const inspectedPaths = [];
    for (const file of request.files) {
      if (file !== null && typeof file === 'object') {
        if (
          typeof file.path === 'string' &&
          typeof file.mediaType === 'string' &&
          // Runtime callers can be untyped; Zod remains authoritative for the enum.
          (CONTROLLED_WORKSPACE_MEDIA_TYPES as readonly string[]).includes(file.mediaType)
        ) {
          try {
            inspectedPaths.push(
              inspectSafeWorkspacePath(
                file.path,
                file.mediaType as WorkspacePlanRequest['files'][number]['mediaType'],
                CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS,
              ),
            );
          } catch (error) {
            if (error instanceof PathSafetyFailure) throw pathError(error);
            throw error;
          }
        }
      }
      if (file !== null && typeof file === 'object' && typeof file.content === 'string') {
        try {
          assertSafeWorkspaceContent(file.content);
        } catch (error) {
          if (error instanceof ContentSafetyFailure) {
            throw new ControlledWorkspaceError('Conteúdo sensível foi rejeitado.', {
              code: CONTROLLED_WORKSPACE_ERROR_CODES.UNSUPPORTED_CONTENT,
              stage: CONTROLLED_WORKSPACE_ERROR_STAGES.REQUEST_VALIDATION,
              sourceCode: error.reason,
            });
          }
          throw error;
        }
      }
    }
    try {
      assertNoWorkspacePathCollisions(inspectedPaths);
    } catch (error) {
      if (error instanceof PathSafetyFailure) {
        throw new ControlledWorkspaceError(
          'Os caminhos colidem ou criam conflito entre arquivo e diretório.',
          {
            code: CONTROLLED_WORKSPACE_ERROR_CODES.PATH_COLLISION,
            stage: CONTROLLED_WORKSPACE_ERROR_STAGES.PATH_VALIDATION,
            sourceCode: error.reason,
          },
        );
      }
      throw error;
    }
  }
  const parsed = workspacePlanRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new ControlledWorkspaceError('A solicitação do workspace controlado é inválida.', {
      code: CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_REQUEST,
      stage: CONTROLLED_WORKSPACE_ERROR_STAGES.REQUEST_VALIDATION,
    });
  }

  assertConfiguredLimits(parsed.data, limits);
  const files = parsed.data.files.map(buildPlanFile).sort(sortPath);
  const fileMetadata = files.map((file) => ({
    path: file.path,
    encoding: file.encoding,
    mediaType: file.mediaType,
    purpose: file.purpose,
    byteLength: file.byteLength,
    contentHash: file.contentHash,
    structuralHash: file.structuralHash,
  }));
  const policyHash = calculateWorkspacePolicyHash(limits);
  const configurationHash = calculateWorkspaceConfigurationHash(limits);
  const planHash = calculateWorkspacePlanHash({
    source: parsed.data.source,
    files: fileMetadata,
    policyHash,
    configurationHash,
  });
  const candidate = {
    workspaceId: deriveWorkspaceId(planHash),
    source: parsed.data.source,
    files,
    metadata: {
      workspaceVersion: CONTROLLED_WORKSPACE_VERSION,
      contractVersion: CONTROLLED_WORKSPACE_CONTRACT_VERSION,
      hashAlgorithm: CONTROLLED_WORKSPACE_HASH_ALGORITHM,
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.byteLength, 0),
      planHash,
      policyHash,
      configurationHash,
    },
    lineage: {
      technicalSpecificationHash: parsed.data.source.technicalSpecificationHash,
      bundleHash: parsed.data.source.bundleHash,
      bundleContentHash: parsed.data.source.bundleContentHash,
      planHash,
    },
  };
  const plan = workspacePlanSchema.safeParse(candidate);
  if (!plan.success) {
    throw new ControlledWorkspaceError('Não foi possível construir um plano consistente.', {
      code: CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_REQUEST,
      stage: CONTROLLED_WORKSPACE_ERROR_STAGES.PLAN_CREATION,
    });
  }
  return immutableClone(plan.data);
}

export function createControlledWorkspacePlanner(
  options: CreateControlledWorkspacePlannerOptions = {},
): ControlledWorkspacePlanner {
  const limits = resolveControlledWorkspaceLimits(options.limits);
  return Object.freeze({
    plan: (request: WorkspacePlanRequest) => createWorkspacePlan(request, { limits }),
  });
}
