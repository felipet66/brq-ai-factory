import { agentRunResultSchema } from '@brq/agent-runner';
import { identifierSchema, semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import { jsonObjectSchema, jsonValueSchema } from '@brq/shared/schemas/json-value.schema';
import { z } from 'zod';

import { RESPONSE_VALIDATION_STAGES, RESPONSE_VALIDATOR_ERROR_CODES } from './errors';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const VALIDATION_ISSUE_CODES = {
  FINISH_REASON_MAX_OUTPUT_TOKENS: 'FINISH_REASON_MAX_OUTPUT_TOKENS',
  FINISH_REASON_CONTENT_FILTER: 'FINISH_REASON_CONTENT_FILTER',
  FINISH_REASON_REFUSAL: 'FINISH_REASON_REFUSAL',
  CONTENT_MISSING: 'CONTENT_MISSING',
  CONTENT_TOO_LARGE: 'CONTENT_TOO_LARGE',
  CONTENT_NESTING_TOO_DEEP: 'CONTENT_NESTING_TOO_DEEP',
  MALFORMED_JSON: 'MALFORMED_JSON',
  SCHEMA_MISMATCH: 'SCHEMA_MISMATCH',
  STRUCTURED_DATA_UNAVAILABLE: 'STRUCTURED_DATA_UNAVAILABLE',
  STRUCTURED_DATA_NESTING_TOO_DEEP: 'STRUCTURED_DATA_NESTING_TOO_DEEP',
  STRUCTURED_DATA_SCHEMA_MISMATCH: 'STRUCTURED_DATA_SCHEMA_MISMATCH',
  STRUCTURED_DATA_MISMATCH: 'STRUCTURED_DATA_MISMATCH',
} as const;

export const validationContractFormatSchema = z.enum(['TEXT', 'JSON_SCHEMA']);
export const jsonSchemaDialectSchema = z.literal('DRAFT_2020_12');
export const validationIssueSeveritySchema = z.enum(['ERROR', 'WARNING', 'INFO']);
export const validationIssueCategorySchema = z.enum([
  'FINISH_REASON',
  'CONTENT',
  'JSON_SYNTAX',
  'SCHEMA',
  'INTEGRITY',
]);
export const validationIssueCodeSchema = z.enum(Object.values(VALIDATION_ISSUE_CODES));
const validationContractBase = {
  id: identifierSchema,
  version: semanticVersionSchema,
  expectedOutputContractHash: hashSchema,
};

export const validationContractSchema = z.discriminatedUnion('format', [
  z.object({ ...validationContractBase, format: z.literal('TEXT') }).strict(),
  z
    .object({
      ...validationContractBase,
      format: z.literal('JSON_SCHEMA'),
      dialect: jsonSchemaDialectSchema,
      schema: jsonObjectSchema,
    })
    .strict(),
]);

export const validationRequestSchema = z
  .object({
    runResult: agentRunResultSchema,
    contract: validationContractSchema,
  })
  .strict();

export const validationIssueSchema = z
  .object({
    code: validationIssueCodeSchema,
    severity: validationIssueSeveritySchema,
    category: validationIssueCategorySchema,
    instancePath: z.string().min(1).max(1_024).optional(),
    schemaPath: z.string().min(1).max(1_024).optional(),
    keyword: z.string().trim().min(1).max(128).optional(),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const validatedOutputSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('TEXT'), content: z.string() }).strict(),
  z.object({ format: z.literal('JSON_SCHEMA'), data: jsonValueSchema }).strict(),
]);

export const validationMetadataSchema = z
  .object({
    contract: z
      .object({
        id: identifierSchema,
        version: semanticVersionSchema,
        format: validationContractFormatSchema,
        contractHash: hashSchema,
      })
      .strict(),
    source: z
      .object({
        executionId: identifierSchema,
        agentExecutionId: identifierSchema,
        requestId: identifierSchema.optional(),
        traceId: identifierSchema.optional(),
        provider: z.string().trim().min(1).max(80),
        model: z.string().trim().min(1).max(200),
        promptHash: hashSchema,
        outputContractHash: hashSchema,
        responseHash: hashSchema,
        finishReason: agentRunResultSchema.shape.output.shape.finishReason,
      })
      .strict(),
    contentHash: hashSchema,
    schemaHash: hashSchema.nullable(),
    validatedValueHash: hashSchema.nullable(),
    validationHash: hashSchema,
    issuesTruncated: z.boolean(),
  })
  .strict();

export const validationResultSchema = z
  .object({
    valid: z.boolean(),
    validatedOutput: validatedOutputSchema.nullable(),
    issues: z.array(validationIssueSchema),
    metadata: validationMetadataSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const hasError = result.issues.some((issue) => issue.severity === 'ERROR');

    if (result.valid && (hasError || result.validatedOutput === null)) {
      context.addIssue({
        code: 'custom',
        message: 'valid=true exige saída validada e ausência de issues ERROR.',
      });
    }

    if (!result.valid && (!hasError || result.validatedOutput !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'valid=false exige ao menos um issue ERROR e saída validada nula.',
      });
    }

    if (
      result.validatedOutput !== null &&
      result.validatedOutput.format !== result.metadata.contract.format
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A saída validada deve corresponder ao formato do contrato.',
        path: ['validatedOutput', 'format'],
      });
    }
  });

export const responseValidationStageSchema = z.enum(RESPONSE_VALIDATION_STAGES);
export const responseValidatorErrorCodeSchema = z.enum(
  Object.values(RESPONSE_VALIDATOR_ERROR_CODES),
);
