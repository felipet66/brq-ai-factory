import { validationResultSchema } from '@brq/response-validator';
import { artifactDraftSchema } from '@brq/shared/schemas/artifact.schema';
import { safeFilenameSchema, semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

import {
  ARTIFACT_GENERATION_STAGES,
  ARTIFACT_GENERATOR_ERROR_CLASSIFICATIONS,
  ARTIFACT_GENERATOR_ERROR_CODES,
} from './errors';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const stableIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value === value.trim(), 'O identificador não pode ser normalizado.');
const artifactNameSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim(), 'O nome não pode ser normalizado.');
const artifactLogicalTypeSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => value === value.trim(), 'O tipo lógico não pode ser normalizado.');
const artifactFilenameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value === value.trim(), 'O filename não pode ser normalizado.')
  .pipe(safeFilenameSchema);

const FORBIDDEN_BINDING_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export const ARTIFACT_FORMATS = ['TEXT', 'JSON'] as const;
export const ARTIFACT_MEDIA_TYPES = ['text/plain', 'text/markdown', 'application/json'] as const;
export const BINDING_SERIALIZATIONS = ['TEXT', 'JSON_COMPACT', 'JSON_PRETTY'] as const;

export const artifactFormatSchema = z.enum(ARTIFACT_FORMATS);
export const artifactMediaTypeSchema = z.enum(ARTIFACT_MEDIA_TYPES);
export const bindingSerializationSchema = z.enum(BINDING_SERIALIZATIONS);
export const bindingPathSegmentSchema = z.union([
  z
    .string()
    .min(1)
    .max(256)
    .refine(
      (segment) => !FORBIDDEN_BINDING_SEGMENTS.has(segment),
      'O segmento de binding é proibido.',
    ),
  z.number().int().nonnegative(),
]);
export const bindingPathSchema = z.array(bindingPathSegmentSchema).max(256);

export const artifactBindingSchema = z
  .object({
    id: stableIdentifierSchema,
    path: bindingPathSchema,
  })
  .strict();

export const literalFragmentSchema = z
  .object({
    kind: z.literal('LITERAL'),
    value: z.string(),
  })
  .strict();

export const bindingFragmentSchema = z
  .object({
    kind: z.literal('BINDING'),
    bindingId: stableIdentifierSchema,
    serialization: bindingSerializationSchema,
  })
  .strict();

export const textTemplateFragmentSchema = z.discriminatedUnion('kind', [
  literalFragmentSchema,
  bindingFragmentSchema,
]);

const artifactTemplateBase = {
  id: stableIdentifierSchema,
  name: artifactNameSchema,
  filename: artifactFilenameSchema,
  type: artifactLogicalTypeSchema,
  bindings: z.array(artifactBindingSchema).max(2_048),
};

export const textArtifactTemplateSchema = z
  .object({
    ...artifactTemplateBase,
    format: z.literal('TEXT'),
    mediaType: z.enum(['text/plain', 'text/markdown']),
    fragments: z.array(textTemplateFragmentSchema).min(1).max(4_096),
  })
  .strict();

export const jsonArtifactTemplateSchema = z
  .object({
    ...artifactTemplateBase,
    format: z.literal('JSON'),
    mediaType: z.literal('application/json'),
    rootBindingId: stableIdentifierSchema,
  })
  .strict();

export const artifactTemplateSchema = z
  .discriminatedUnion('format', [textArtifactTemplateSchema, jsonArtifactTemplateSchema])
  .superRefine((template, context) => {
    const bindingIds = new Set<string>();
    for (const [index, binding] of template.bindings.entries()) {
      if (bindingIds.has(binding.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Os IDs dos bindings devem ser únicos dentro do template.',
          path: ['bindings', index, 'id'],
        });
      }
      bindingIds.add(binding.id);
    }

    const references: readonly { readonly bindingId: string; readonly fragmentIndex?: number }[] =
      template.format === 'TEXT'
        ? template.fragments.flatMap((fragment, fragmentIndex) =>
            fragment.kind === 'BINDING' ? [{ bindingId: fragment.bindingId, fragmentIndex }] : [],
          )
        : [{ bindingId: template.rootBindingId }];
    const referencedIds = new Set(references.map(({ bindingId }) => bindingId));

    for (const reference of references) {
      if (!bindingIds.has(reference.bindingId)) {
        context.addIssue({
          code: 'custom',
          message: 'O template referencia um binding inexistente.',
          path:
            template.format === 'TEXT'
              ? ['fragments', reference.fragmentIndex!, 'bindingId']
              : ['rootBindingId'],
        });
      }
    }

    for (const [index, binding] of template.bindings.entries()) {
      if (!referencedIds.has(binding.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Bindings não utilizados não são permitidos.',
          path: ['bindings', index, 'id'],
        });
      }
    }
  });

export const artifactSourceContractSchema = validationResultSchema.shape.metadata.shape.contract;

export const artifactSpecificationSchema = z
  .object({
    id: stableIdentifierSchema,
    version: semanticVersionSchema,
    sourceContract: artifactSourceContractSchema,
    templates: z.array(artifactTemplateSchema).min(1).max(256),
  })
  .strict()
  .superRefine((specification, context) => {
    const templateIds = new Set<string>();
    const filenames = new Set<string>();

    for (const [index, template] of specification.templates.entries()) {
      if (templateIds.has(template.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Os IDs dos templates devem ser únicos.',
          path: ['templates', index, 'id'],
        });
      }

      const portableFilename = template.filename.normalize('NFC').toLowerCase();
      if (filenames.has(portableFilename)) {
        context.addIssue({
          code: 'custom',
          message: 'Os filenames dos templates devem ser únicos de forma portável.',
          path: ['templates', index, 'filename'],
        });
      }

      templateIds.add(template.id);
      filenames.add(portableFilename);
    }
  });

export const artifactGenerationRequestSchema = z
  .object({
    validation: validationResultSchema,
    specification: artifactSpecificationSchema,
  })
  .strict();

export const generatedArtifactMetadataSchema = z
  .object({
    templateId: stableIdentifierSchema,
    format: artifactFormatSchema,
    mediaType: artifactMediaTypeSchema,
    templateHash: hashSchema,
    contentHash: hashSchema,
    draftHash: hashSchema,
    byteLength: z.number().int().nonnegative(),
  })
  .strict();

export const generatedArtifactSchema = z
  .object({
    draft: artifactDraftSchema,
    metadata: generatedArtifactMetadataSchema,
  })
  .strict();

const validationSourceSchema = validationResultSchema.shape.metadata.shape.source;

export const artifactGenerationSourceSchema = z
  .object({
    executionId: validationSourceSchema.shape.executionId,
    agentExecutionId: validationSourceSchema.shape.agentExecutionId,
    requestId: validationSourceSchema.shape.requestId,
    traceId: validationSourceSchema.shape.traceId,
    provider: validationSourceSchema.shape.provider,
    model: validationSourceSchema.shape.model,
    promptHash: validationSourceSchema.shape.promptHash,
    outputContractHash: validationSourceSchema.shape.outputContractHash,
    responseHash: validationSourceSchema.shape.responseHash,
    finishReason: validationSourceSchema.shape.finishReason,
    contractId: artifactSourceContractSchema.shape.id,
    contractVersion: artifactSourceContractSchema.shape.version,
    contractFormat: artifactSourceContractSchema.shape.format,
    contractHash: artifactSourceContractSchema.shape.contractHash,
    validationHash: hashSchema,
    validatedValueHash: hashSchema,
  })
  .strict();

export const artifactGenerationMetadataSchema = z
  .object({
    specificationId: stableIdentifierSchema,
    specificationVersion: semanticVersionSchema,
    specificationHash: hashSchema,
    source: artifactGenerationSourceSchema,
    artifactCount: z.number().int().positive(),
    totalBytes: z.number().int().nonnegative(),
    generationHash: hashSchema,
  })
  .strict();

export const artifactGenerationResultSchema = z
  .object({
    artifacts: z.array(generatedArtifactSchema).min(1),
    metadata: artifactGenerationMetadataSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.artifacts.length !== result.metadata.artifactCount) {
      context.addIssue({
        code: 'custom',
        message: 'artifactCount deve corresponder à quantidade de artifacts.',
        path: ['metadata', 'artifactCount'],
      });
    }

    const totalBytes = result.artifacts.reduce(
      (total, artifact) => total + artifact.metadata.byteLength,
      0,
    );
    if (totalBytes !== result.metadata.totalBytes) {
      context.addIssue({
        code: 'custom',
        message: 'totalBytes deve corresponder à soma dos artifacts.',
        path: ['metadata', 'totalBytes'],
      });
    }
  });

export const artifactGenerationStageSchema = z.enum(ARTIFACT_GENERATION_STAGES);
export const artifactGeneratorErrorClassificationSchema = z.enum(
  ARTIFACT_GENERATOR_ERROR_CLASSIFICATIONS,
);
export const artifactGeneratorErrorCodeSchema = z.enum(
  Object.values(ARTIFACT_GENERATOR_ERROR_CODES),
);
