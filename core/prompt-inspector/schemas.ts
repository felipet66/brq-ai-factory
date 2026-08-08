import { Buffer } from 'node:buffer';

import { jsonObjectSchema, jsonValueSchema } from '@brq/shared/schemas/json-value.schema';
import { z } from 'zod';

import {
  PROMPT_INSPECTOR_MAX_ADAPTERS,
  PROMPT_INSPECTOR_MAX_CANDIDATE_BYTES,
  PROMPT_INSPECTOR_MAX_EXAMPLES_PER_AGENT,
  PROMPT_INSPECTOR_MAX_ISSUES,
} from './limits';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const sourceHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const semanticVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const boundedText = (max: number) => z.string().trim().min(1).max(max);
const inspectionPathSegmentSchema = z.union([z.string().max(256), z.number().int().nonnegative()]);

export const promptInspectionAgentSchema = z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']);
export const promptInspectionInputKindSchema = z.enum([
  'HUMAN_DEMAND',
  'PRODUCT_OWNER_SPECIFICATION',
  'QA_HANDOFF',
]);
export const promptInspectionRetentionSchema = z.literal('EPHEMERAL');
export const promptInspectionStageSchema = z.enum([
  'KNOWLEDGE',
  'RULES',
  'TEMPLATE',
  'RESOLUTION',
  'RENDERING',
  'BUDGET',
  'CONTRACT',
]);
export const promptInspectionNodeStatusSchema = z.enum(['IDLE', 'VALID', 'WARNING', 'ERROR']);
export const promptValidationStageNameSchema = z.enum([
  'RESPONSE_VALIDATOR',
  'JSON_SCHEMA',
  'AGENT_CONTRACT',
  'BUSINESS_VALIDATION',
]);
export const promptValidationStageStatusSchema = z.enum(['PASS', 'FAIL', 'NOT_RUN']);

export const promptInspectionVersionsSchema = z
  .object({
    inspectorVersion: semanticVersionSchema,
    contractVersion: semanticVersionSchema,
    agentVersion: semanticVersionSchema,
    promptVersion: semanticVersionSchema,
    promptSchemaVersion: semanticVersionSchema,
    outputContractVersion: semanticVersionSchema,
  })
  .strict();

export const promptInspectionExampleSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    label: boundedText(120),
    description: boundedText(500),
    input: jsonValueSchema,
    candidate: z.string().max(PROMPT_INSPECTOR_MAX_CANDIDATE_BYTES).optional(),
  })
  .strict();

export const promptInspectionPipelineNodeSchema = z
  .object({
    stage: promptInspectionStageSchema,
    status: promptInspectionNodeStatusSchema,
    detail: boundedText(500).nullable(),
  })
  .strict();

export const promptInspectionCatalogAgentSchema = z
  .object({
    agent: promptInspectionAgentSchema,
    label: boundedText(120),
    description: boundedText(500),
    inputKind: promptInspectionInputKindSchema,
    versions: promptInspectionVersionsSchema,
    activeBundleHash: hashSchema,
    examples: z.array(promptInspectionExampleSchema).max(PROMPT_INSPECTOR_MAX_EXAMPLES_PER_AGENT),
  })
  .strict();

export const promptInspectionCatalogSchema = z
  .object({
    contractVersion: semanticVersionSchema,
    retention: promptInspectionRetentionSchema,
    pipeline: z.array(promptInspectionPipelineNodeSchema).length(7),
    agents: z.array(promptInspectionCatalogAgentSchema).min(1).max(PROMPT_INSPECTOR_MAX_ADAPTERS),
  })
  .strict();

export const promptInspectionPreviewRequestSchema = z
  .object({ agent: promptInspectionAgentSchema, input: jsonValueSchema })
  .strict();

export const promptInspectionValidateRequestSchema = z
  .object({
    agent: promptInspectionAgentSchema,
    input: jsonValueSchema,
    candidate: z
      .object({
        content: z
          .string()
          .refine(
            (content) => Buffer.byteLength(content, 'utf8') <= PROMPT_INSPECTOR_MAX_CANDIDATE_BYTES,
            'A saída candidata excede o limite do Prompt Inspector.',
          ),
      })
      .strict(),
  })
  .strict();

export const promptInspectionSectionSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.string().min(1).max(80),
    channel: z.enum(['INSTRUCTIONS', 'INPUT']),
    trust: z.enum(['TRUSTED', 'UNTRUSTED']),
    hash: hashSchema,
    sizeBytes: z.number().int().nonnegative(),
    blocks: z.array(
      z
        .object({
          id: z.string().min(1).max(128),
          kind: z.string().min(1).max(80),
          hash: hashSchema,
          sizeBytes: z.number().int().nonnegative(),
          fragments: z.array(
            z
              .object({
                id: z.string().min(1).max(384),
                type: z.string().min(1).max(80),
                sourceId: z.string().min(1).max(128).nullable(),
                sourceItemId: z.string().min(1).max(128).nullable(),
                hash: hashSchema,
                sizeBytes: z.number().int().nonnegative(),
                content: z.string(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export const promptInspectionTrustBoundariesSchema = z
  .object({
    trustedSectionIds: z.array(z.string().min(1).max(128)),
    untrustedSectionIds: z.array(z.string().min(1).max(128)),
  })
  .strict();

export const promptInspectionBudgetSchema = z
  .object({
    maxBytes: z.number().int().positive(),
    usedBytes: z.number().int().nonnegative(),
    remainingBytes: z.number().int().nonnegative(),
    utilizationPercent: z.number().min(0).max(100),
    instructionsBytes: z.number().int().nonnegative(),
    inputBytes: z.number().int().nonnegative(),
    outputContractBytes: z.number().int().nonnegative(),
    status: z.enum(['VALID', 'WARNING']),
  })
  .strict();

export const promptInspectionKnowledgeSchema = z
  .object({
    context: z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']),
    manifestVersion: semanticVersionSchema,
    policyVersion: semanticVersionSchema,
    contextHash: sourceHashSchema,
    budget: z
      .object({
        maxDocuments: z.number().int().positive(),
        maxBytes: z.number().int().positive(),
        usedDocuments: z.number().int().nonnegative(),
        usedBytes: z.number().int().nonnegative(),
      })
      .strict(),
    documents: z.array(
      z
        .object({
          id: z.string().min(1).max(128),
          title: boundedText(512),
          category: z.string().min(1).max(80),
          order: z.number().int().nonnegative(),
          hash: sourceHashSchema,
          sizeBytes: z.number().int().nonnegative(),
          selection: z.enum(['REQUIRED', 'OPTIONAL']),
        })
        .strict(),
    ),
    ignored: z.array(
      z
        .object({
          id: z.string().min(1).max(128).nullable(),
          reason: z.enum(['NOT_SELECTED', 'NOT_IN_MANIFEST', 'BUDGET_EXCEEDED']),
        })
        .strict(),
    ),
    missing: z.array(z.object({ id: z.string().min(1).max(128), required: z.boolean() }).strict()),
  })
  .strict();

const ruleSetHashSchema = z
  .object({
    ruleSetId: z.string().min(1).max(128),
    version: semanticVersionSchema,
    scope: z.enum(['GLOBAL', 'SECURITY', 'AGENT']),
    agent: z.string().min(1).max(80).nullable(),
    hash: hashSchema,
  })
  .strict();

const contextHashSchema = z
  .object({
    contextId: z.string().min(1).max(128),
    kind: z.enum(['KNOWLEDGE', 'EXECUTION', 'USER_INPUT', 'ARTIFACT']),
    serialization: z.enum(['TEXT', 'JSON']),
    contentHash: sourceHashSchema,
    descriptorHash: hashSchema,
    references: z.array(
      z
        .object({
          id: z.string().min(1).max(128),
          category: z.string().min(1).max(128).nullable(),
          hash: sourceHashSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const promptInspectionHashesSchema = z
  .object({
    bundleHash: hashSchema,
    templateHash: hashSchema,
    promptHash: hashSchema,
    instructionsHash: hashSchema,
    inputHash: hashSchema,
    outputContractHash: hashSchema,
    ruleSetHashes: z.array(ruleSetHashSchema),
    contextHashes: z.array(contextHashSchema),
  })
  .strict();

export const promptInspectionOutputContractSchema = z
  .object({
    id: z.string().min(1).max(128),
    version: semanticVersionSchema,
    format: z.enum(['TEXT', 'JSON_SCHEMA']),
    contractHash: hashSchema,
    dialect: z.literal('DRAFT_2020_12').nullable(),
    schemaHash: hashSchema.nullable(),
    instructions: z.array(z.string().min(1)),
    schema: jsonObjectSchema.nullable(),
    summary: z
      .object({
        rootTypes: z.array(z.string().min(1).max(64)),
        totalNodes: z.number().int().nonnegative(),
        propertyCount: z.number().int().nonnegative(),
        requiredCount: z.number().int().nonnegative(),
        objectCount: z.number().int().nonnegative(),
        arrayCount: z.number().int().nonnegative(),
        enumCount: z.number().int().nonnegative(),
        truncated: z.boolean(),
        nodes: z.array(
          z
            .object({
              path: z.string().min(1).max(2_048),
              types: z.array(z.string().min(1).max(64)),
              required: z.boolean(),
              enumValues: z.array(jsonValueSchema),
              constraints: z.array(
                z.object({ key: z.string().min(1).max(80), value: jsonValueSchema }).strict(),
              ),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

export const promptInspectionBuiltPreviewSchema = z
  .object({
    status: z.literal('BUILT'),
    agent: promptInspectionAgentSchema,
    retention: promptInspectionRetentionSchema,
    versions: promptInspectionVersionsSchema,
    pipeline: z.array(promptInspectionPipelineNodeSchema).length(7),
    sections: z.array(promptInspectionSectionSchema),
    trustBoundaries: promptInspectionTrustBoundariesSchema,
    prompt: z.object({ instructions: z.string(), input: z.string() }).strict(),
    budget: promptInspectionBudgetSchema,
    knowledge: promptInspectionKnowledgeSchema,
    hashes: promptInspectionHashesSchema,
    outputContract: promptInspectionOutputContractSchema,
  })
  .strict();

export const promptInspectionRejectedPreviewSchema = z
  .object({
    status: z.literal('REJECTED'),
    agent: promptInspectionAgentSchema,
    retention: promptInspectionRetentionSchema,
    pipeline: z.array(promptInspectionPipelineNodeSchema).length(7),
    error: z
      .object({
        code: z.string().min(1).max(128),
        stage: promptInspectionStageSchema,
        message: boundedText(500),
      })
      .strict(),
  })
  .strict();

export const promptInspectionPreviewResultSchema = z.discriminatedUnion('status', [
  promptInspectionBuiltPreviewSchema,
  promptInspectionRejectedPreviewSchema,
]);

export const promptInspectionIssueSchema = z
  .object({
    code: z.string().min(1).max(128),
    path: z.array(inspectionPathSegmentSchema).max(32),
    keyword: z.string().min(1).max(128).nullable(),
    message: boundedText(500),
  })
  .strict();

export const promptValidationStageSchema = z
  .object({
    stage: promptValidationStageNameSchema,
    status: promptValidationStageStatusSchema,
    issues: z.array(promptInspectionIssueSchema).max(PROMPT_INSPECTOR_MAX_ISSUES),
    issuesTruncated: z.boolean(),
  })
  .strict();

export const promptInspectionValidationResultSchema = z
  .object({
    status: z.enum(['PASS', 'FAIL']),
    agent: promptInspectionAgentSchema,
    retention: promptInspectionRetentionSchema,
    candidateHash: hashSchema,
    contract: promptInspectionOutputContractSchema,
    stages: z.array(promptValidationStageSchema).length(4),
  })
  .strict();
