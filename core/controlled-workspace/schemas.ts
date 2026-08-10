import { z } from 'zod';

import { assertSafeWorkspaceContent } from './content-safety';
import {
  calculateMaterializedWorkspaceHash,
  calculateWorkspaceBundleContentHash,
  calculateWorkspaceContentHash,
  calculateWorkspaceFileStructuralHash,
  calculateWorkspacePlanHash,
  deriveWorkspaceId,
} from './hashing';
import { CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS } from './limits';
import {
  CONTROLLED_WORKSPACE_MEDIA_TYPES,
  assertNoWorkspacePathCollisions,
  inspectSafeWorkspacePath,
} from './path-safety';
import {
  CONTROLLED_WORKSPACE_CONTRACT_VERSION,
  CONTROLLED_WORKSPACE_HASH_ALGORITHM,
  CONTROLLED_WORKSPACE_VERSION,
} from './version';

const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/u;
const PREFIXED_SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SEMANTIC_VERSION = /^\d+\.\d+\.\d+$/u;
const DISALLOWED_TEXT_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (current >= 0xdc00 && current <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export const controlledWorkspaceHashSchema = z.string().regex(LOWERCASE_SHA256);

export const workspaceSourceHashesSchema = z
  .object({
    technicalSpecificationHash: z.string().regex(PREFIXED_SHA256),
    generationHash: controlledWorkspaceHashSchema,
    bundleHash: controlledWorkspaceHashSchema,
    bundleContentHash: controlledWorkspaceHashSchema,
    bundleVersion: z.string().regex(SEMANTIC_VERSION),
    contractVersion: z.string().regex(SEMANTIC_VERSION),
  })
  .strict();

export const workspaceFileEncodingSchema = z.literal('UTF-8');
export const workspaceFileMediaTypeSchema = z.enum(CONTROLLED_WORKSPACE_MEDIA_TYPES);
export const workspaceFilePurposeSchema = z.enum([
  'SOURCE',
  'TEST',
  'CONFIGURATION',
  'DOCUMENTATION',
  'STYLE',
  'SCHEMA',
]);

export const workspaceFileRequestSchema = z
  .object({
    path: z.string().min(1),
    content: z
      .string()
      .refine(isWellFormedUnicode, 'O conteúdo deve ser texto Unicode bem formado.')
      .refine((value) => !DISALLOWED_TEXT_CONTROL.test(value), {
        message: 'Conteúdo binário ou com caracteres de controle não é permitido.',
      })
      .refine(
        (value) => {
          try {
            assertSafeWorkspaceContent(value);
            return true;
          } catch {
            return false;
          }
        },
        { message: 'Conteúdo sensível não pode ser materializado.' },
      )
      .refine(
        (value) =>
          Buffer.byteLength(value, 'utf8') <= CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxFileBytes,
        'O arquivo excede o limite absoluto de bytes.',
      ),
    encoding: workspaceFileEncodingSchema,
    mediaType: workspaceFileMediaTypeSchema,
    purpose: workspaceFilePurposeSchema,
    byteLength: z
      .number()
      .int()
      .nonnegative()
      .max(CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxFileBytes),
    contentHash: controlledWorkspaceHashSchema,
  })
  .strict();

export const workspacePlanRequestSchema = z
  .object({
    source: workspaceSourceHashesSchema,
    files: z
      .array(workspaceFileRequestSchema)
      .min(1)
      .max(CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxFiles),
  })
  .strict()
  .superRefine((request, context) => {
    const inspected = [];
    let totalBytes = 0;
    for (const [index, file] of request.files.entries()) {
      const byteLength = Buffer.byteLength(file.content, 'utf8');
      const contentHash = calculateWorkspaceContentHash(file.content);
      totalBytes += byteLength;
      if (file.byteLength !== byteLength || file.contentHash !== contentHash) {
        context.addIssue({
          code: 'custom',
          path: ['files', index],
          message: 'Os metadados declarados não correspondem ao conteúdo do arquivo.',
        });
      }
      try {
        inspected.push(
          inspectSafeWorkspacePath(file.path, file.mediaType, CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS),
        );
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['files', index, 'path'],
          message: 'O caminho do arquivo não é seguro ou não corresponde ao media type.',
        });
      }
    }
    try {
      assertNoWorkspacePathCollisions(inspected);
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'Os caminhos contêm colisão portátil ou conflito entre arquivo e diretório.',
      });
    }
    if (totalBytes > CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxBundleBytes) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'O bundle excede o limite absoluto de bytes.',
      });
    }
    const bundleContentHash = calculateWorkspaceBundleContentHash(request.files);
    if (request.source.bundleContentHash !== bundleContentHash) {
      context.addIssue({
        code: 'custom',
        path: ['source', 'bundleContentHash'],
        message: 'O hash canônico do conteúdo do bundle não corresponde aos arquivos.',
      });
    }
  });

export const workspacePlanFileSchema = workspaceFileRequestSchema.extend({
  structuralHash: controlledWorkspaceHashSchema,
});

const workspaceBaseMetadataSchema = z
  .object({
    workspaceVersion: z.literal(CONTROLLED_WORKSPACE_VERSION),
    contractVersion: z.literal(CONTROLLED_WORKSPACE_CONTRACT_VERSION),
    hashAlgorithm: z.literal(CONTROLLED_WORKSPACE_HASH_ALGORITHM),
    fileCount: z.number().int().positive().max(CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxFiles),
    totalBytes: z
      .number()
      .int()
      .nonnegative()
      .max(CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxBundleBytes),
    planHash: controlledWorkspaceHashSchema,
    policyHash: controlledWorkspaceHashSchema,
    configurationHash: controlledWorkspaceHashSchema,
  })
  .strict();

function planFileMetadata(file: z.infer<typeof workspacePlanFileSchema>) {
  return {
    path: file.path,
    encoding: file.encoding,
    mediaType: file.mediaType,
    purpose: file.purpose,
    byteLength: file.byteLength,
    contentHash: file.contentHash,
    structuralHash: file.structuralHash,
  };
}

function bundleFileMetadata(file: z.infer<typeof workspacePlanFileSchema>) {
  return {
    path: file.path,
    encoding: file.encoding,
    mediaType: file.mediaType,
    purpose: file.purpose,
    byteLength: file.byteLength,
    contentHash: file.contentHash,
  };
}

interface WorkspaceMetadataFile {
  readonly path: string;
  readonly encoding: 'UTF-8';
  readonly mediaType: z.infer<typeof workspaceFileMediaTypeSchema>;
  readonly purpose: z.infer<typeof workspaceFilePurposeSchema>;
  readonly byteLength: number;
  readonly contentHash: string;
  readonly structuralHash: string;
}

function validateWorkspaceMetadataFiles(
  files: readonly WorkspaceMetadataFile[],
  context: z.core.$RefinementCtx,
): number {
  const inspected = [];
  let totalBytes = 0;
  let previousPath: string | undefined;

  for (const [index, file] of files.entries()) {
    totalBytes += file.byteLength;
    try {
      inspected.push(
        inspectSafeWorkspacePath(file.path, file.mediaType, CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS),
      );
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['files', index, 'path'],
        message: 'O caminho materializado não é seguro ou não corresponde ao media type.',
      });
    }

    const structuralHash = calculateWorkspaceFileStructuralHash({
      path: file.path,
      encoding: file.encoding,
      mediaType: file.mediaType,
      purpose: file.purpose,
      byteLength: file.byteLength,
      contentHash: file.contentHash,
    });
    if (structuralHash !== file.structuralHash) {
      context.addIssue({
        code: 'custom',
        path: ['files', index, 'structuralHash'],
        message: 'O hash estrutural do arquivo é inconsistente.',
      });
    }
    if (previousPath !== undefined && previousPath >= file.path) {
      context.addIssue({
        code: 'custom',
        path: ['files', index, 'path'],
        message: 'Os arquivos devem estar em ordem canônica estrita.',
      });
    }
    previousPath = file.path;
  }

  try {
    assertNoWorkspacePathCollisions(inspected);
  } catch {
    context.addIssue({
      code: 'custom',
      path: ['files'],
      message: 'Os caminhos contêm colisão portátil ou conflito entre arquivo e diretório.',
    });
  }
  if (totalBytes > CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxBundleBytes) {
    context.addIssue({
      code: 'custom',
      path: ['files'],
      message: 'O conjunto de arquivos excede o limite absoluto de bytes.',
    });
  }

  return totalBytes;
}

export const workspacePlanSchema = z
  .object({
    workspaceId: z.string().regex(/^workspace-[a-f0-9]{32}$/u),
    source: workspaceSourceHashesSchema,
    files: z
      .array(workspacePlanFileSchema)
      .min(1)
      .max(CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxFiles),
    metadata: workspaceBaseMetadataSchema,
    lineage: z
      .object({
        technicalSpecificationHash: z.string().regex(PREFIXED_SHA256),
        bundleHash: controlledWorkspaceHashSchema,
        bundleContentHash: controlledWorkspaceHashSchema,
        planHash: controlledWorkspaceHashSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((plan, context) => {
    const declaredTotalBytes = validateWorkspaceMetadataFiles(plan.files, context);
    let totalBytes = 0;
    for (const [index, file] of plan.files.entries()) {
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
      if (
        byteLength !== file.byteLength ||
        contentHash !== file.contentHash ||
        structuralHash !== file.structuralHash
      ) {
        context.addIssue({
          code: 'custom',
          path: ['files', index],
          message: 'Os metadados do arquivo não correspondem ao conteúdo.',
        });
      }
      totalBytes += byteLength;
    }
    if (totalBytes > CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxBundleBytes) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'O conteúdo do plano excede o limite absoluto de bytes.',
      });
    }
    const planHash = calculateWorkspacePlanHash({
      source: plan.source,
      files: plan.files.map(planFileMetadata),
      policyHash: plan.metadata.policyHash,
      configurationHash: plan.metadata.configurationHash,
    });
    const bundleContentHash = calculateWorkspaceBundleContentHash(
      plan.files.map(bundleFileMetadata),
    );
    if (
      plan.metadata.fileCount !== plan.files.length ||
      plan.metadata.totalBytes !== totalBytes ||
      declaredTotalBytes !== totalBytes ||
      plan.metadata.planHash !== planHash ||
      plan.workspaceId !== deriveWorkspaceId(planHash) ||
      plan.lineage.technicalSpecificationHash !== plan.source.technicalSpecificationHash ||
      plan.lineage.bundleHash !== plan.source.bundleHash ||
      plan.lineage.bundleContentHash !== plan.source.bundleContentHash ||
      plan.source.bundleContentHash !== bundleContentHash ||
      plan.lineage.planHash !== planHash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Os metadados do plano são inconsistentes.',
      });
    }
  });

export const materializedWorkspaceFileSchema = workspacePlanFileSchema.omit({ content: true });

export const workspaceMaterializationResultSchema = z
  .object({
    workspaceId: z.string().regex(/^workspace-[a-f0-9]{32}$/u),
    source: workspaceSourceHashesSchema,
    files: z
      .array(materializedWorkspaceFileSchema)
      .min(1)
      .max(CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxFiles),
    metadata: workspaceBaseMetadataSchema.extend({
      workspaceHash: controlledWorkspaceHashSchema,
    }),
    lineage: z
      .object({
        technicalSpecificationHash: z.string().regex(PREFIXED_SHA256),
        bundleHash: controlledWorkspaceHashSchema,
        bundleContentHash: controlledWorkspaceHashSchema,
        planHash: controlledWorkspaceHashSchema,
        workspaceHash: controlledWorkspaceHashSchema,
      })
      .strict(),
    provenance: z
      .object({
        workspaceVersion: z.literal(CONTROLLED_WORKSPACE_VERSION),
        contractVersion: z.literal(CONTROLLED_WORKSPACE_CONTRACT_VERSION),
        sourceBundleVersion: z.string().regex(SEMANTIC_VERSION),
        sourceContractVersion: z.string().regex(SEMANTIC_VERSION),
        adapter: z.literal('FILESYSTEM'),
        policyHash: controlledWorkspaceHashSchema,
        configurationHash: controlledWorkspaceHashSchema,
        fileCount: z.number().int().positive().max(CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxFiles),
        totalBytes: z
          .number()
          .int()
          .nonnegative()
          .max(CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxBundleBytes),
      })
      .strict(),
  })
  .strict()
  .superRefine((result, context) => {
    const totalBytes = validateWorkspaceMetadataFiles(result.files, context);
    const planHash = calculateWorkspacePlanHash({
      source: result.source,
      files: result.files,
      policyHash: result.metadata.policyHash,
      configurationHash: result.metadata.configurationHash,
    });
    const workspaceHash = calculateMaterializedWorkspaceHash({
      workspaceId: result.workspaceId,
      planHash: result.metadata.planHash,
      source: result.source,
      files: result.files,
      policyHash: result.metadata.policyHash,
      configurationHash: result.metadata.configurationHash,
    });
    const bundleContentHash = calculateWorkspaceBundleContentHash(result.files);
    if (
      result.metadata.workspaceHash !== workspaceHash ||
      result.metadata.planHash !== planHash ||
      result.workspaceId !== deriveWorkspaceId(planHash) ||
      result.metadata.fileCount !== result.files.length ||
      result.metadata.totalBytes !== totalBytes ||
      result.lineage.technicalSpecificationHash !== result.source.technicalSpecificationHash ||
      result.lineage.bundleHash !== result.source.bundleHash ||
      result.lineage.bundleContentHash !== result.source.bundleContentHash ||
      result.source.bundleContentHash !== bundleContentHash ||
      result.lineage.planHash !== result.metadata.planHash ||
      result.lineage.workspaceHash !== workspaceHash ||
      result.provenance.workspaceVersion !== result.metadata.workspaceVersion ||
      result.provenance.contractVersion !== result.metadata.contractVersion ||
      result.provenance.sourceBundleVersion !== result.source.bundleVersion ||
      result.provenance.sourceContractVersion !== result.source.contractVersion ||
      result.provenance.policyHash !== result.metadata.policyHash ||
      result.provenance.configurationHash !== result.metadata.configurationHash ||
      result.provenance.fileCount !== result.metadata.fileCount ||
      result.provenance.totalBytes !== totalBytes
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Os metadados do workspace materializado são inconsistentes.',
      });
    }
  });

export const workspaceReleaseResultSchema = z
  .object({
    workspaceId: z.string().regex(/^workspace-[a-f0-9]{32}$/u),
    status: z.literal('RELEASED'),
    planHash: controlledWorkspaceHashSchema,
    workspaceHash: controlledWorkspaceHashSchema,
  })
  .strict();
