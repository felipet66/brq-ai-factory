import { z } from 'zod';

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const sourceHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const semanticVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const maxCandidateBytes = 1_048_576;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export const playgroundAgentSchema = z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']);
export type PlaygroundAgent = z.infer<typeof playgroundAgentSchema>;

export const productOwnerPlaygroundInputSchema = z
  .object({
    projectName: z.string().trim().min(1).max(200),
    objective: z.string().trim().min(1).max(16_000),
  })
  .strict();
export const developerPlaygroundInputSchema = z
  .object({ productOwnerSpecification: jsonObjectSchema })
  .strict();
export const qaPlaygroundInputSchema = z
  .object({
    productOwnerSpecification: jsonObjectSchema,
    technicalSpecification: jsonObjectSchema,
  })
  .strict();
export const playgroundInputSchema = z.union([
  productOwnerPlaygroundInputSchema,
  developerPlaygroundInputSchema,
  qaPlaygroundInputSchema,
]);
export type PlaygroundInput = z.infer<typeof playgroundInputSchema>;

export const playgroundPreviewRequestSchema = z.discriminatedUnion('agent', [
  z
    .object({ agent: z.literal('PRODUCT_OWNER'), input: productOwnerPlaygroundInputSchema })
    .strict(),
  z.object({ agent: z.literal('DEVELOPER'), input: developerPlaygroundInputSchema }).strict(),
  z.object({ agent: z.literal('QA'), input: qaPlaygroundInputSchema }).strict(),
]);
export type PlaygroundPreviewRequest = z.infer<typeof playgroundPreviewRequestSchema>;

const candidateSchema = z
  .object({
    content: z
      .string()
      .refine((value) => utf8ByteLength(value) <= maxCandidateBytes, 'Candidate is too large.'),
  })
  .strict();
export const playgroundValidationRequestSchema = z.discriminatedUnion('agent', [
  z
    .object({
      agent: z.literal('PRODUCT_OWNER'),
      input: productOwnerPlaygroundInputSchema,
      candidate: candidateSchema,
    })
    .strict(),
  z
    .object({
      agent: z.literal('DEVELOPER'),
      input: developerPlaygroundInputSchema,
      candidate: candidateSchema,
    })
    .strict(),
  z
    .object({ agent: z.literal('QA'), input: qaPlaygroundInputSchema, candidate: candidateSchema })
    .strict(),
]);
export type PlaygroundValidationRequest = z.infer<typeof playgroundValidationRequestSchema>;

export const playgroundPipelineStageSchema = z.enum([
  'KNOWLEDGE',
  'RULES',
  'TEMPLATE',
  'RESOLUTION',
  'RENDERING',
  'BUDGET',
  'CONTRACT',
]);
export type PlaygroundPipelineStage = z.infer<typeof playgroundPipelineStageSchema>;
export const playgroundPipelineStatusSchema = z.enum(['IDLE', 'VALID', 'WARNING', 'ERROR']);
export type PlaygroundPipelineStatus = z.infer<typeof playgroundPipelineStatusSchema>;

const pipelineNodeSchema = z
  .object({
    stage: playgroundPipelineStageSchema,
    status: playgroundPipelineStatusSchema,
    detail: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

const versionsSchema = z
  .object({
    inspectorVersion: semanticVersionSchema,
    contractVersion: semanticVersionSchema,
    agentVersion: semanticVersionSchema,
    promptVersion: semanticVersionSchema,
    promptSchemaVersion: semanticVersionSchema,
    outputContractVersion: semanticVersionSchema,
  })
  .strict();

const exampleSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    input: jsonValueSchema,
    candidate: z.string().max(1_048_576).optional(),
  })
  .strict();

const agentDescriptorSchema = z
  .object({
    agent: playgroundAgentSchema,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    inputKind: z.enum(['HUMAN_DEMAND', 'PRODUCT_OWNER_SPECIFICATION', 'QA_HANDOFF']),
    versions: versionsSchema,
    activeBundleHash: hashSchema,
    examples: z.array(exampleSchema).max(8),
  })
  .strict();

export const playgroundCatalogSchema = z
  .object({
    contractVersion: semanticVersionSchema,
    retention: z.literal('EPHEMERAL'),
    pipeline: z.array(pipelineNodeSchema).length(7),
    agents: z.array(agentDescriptorSchema).min(1).max(3),
  })
  .strict();
export type PlaygroundCatalog = z.infer<typeof playgroundCatalogSchema>;
export type PlaygroundAgentDescriptor = PlaygroundCatalog['agents'][number];
export type PlaygroundExample = PlaygroundAgentDescriptor['examples'][number];
export type PlaygroundPipelineNode = PlaygroundCatalog['pipeline'][number];

const fragmentSchema = z
  .object({
    id: z.string().min(1).max(384),
    type: z.string().min(1).max(80),
    sourceId: z.string().min(1).max(128).nullable(),
    sourceItemId: z.string().min(1).max(128).nullable(),
    hash: hashSchema,
    sizeBytes: z.number().int().nonnegative(),
    content: z.string(),
  })
  .strict();
const blockSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.string().min(1).max(80),
    hash: hashSchema,
    sizeBytes: z.number().int().nonnegative(),
    fragments: z.array(fragmentSchema),
  })
  .strict();
const sectionSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.string().min(1).max(80),
    channel: z.enum(['INSTRUCTIONS', 'INPUT']),
    trust: z.enum(['TRUSTED', 'UNTRUSTED']),
    hash: hashSchema,
    sizeBytes: z.number().int().nonnegative(),
    blocks: z.array(blockSchema),
  })
  .strict();
const trustBoundariesSchema = z
  .object({
    trustedSectionIds: z.array(z.string().min(1).max(128)),
    untrustedSectionIds: z.array(z.string().min(1).max(128)),
  })
  .strict();
const budgetSchema = z
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
const knowledgeSchema = z
  .object({
    context: playgroundAgentSchema,
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
          title: z.string().trim().min(1).max(512),
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
    contentHash: sourceHashSchema,
    hash: hashSchema,
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
const hashesSchema = z
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
const outputContractSchema = z
  .object({
    id: z.string().min(1).max(128),
    version: semanticVersionSchema,
    contractHash: hashSchema,
    format: z.enum(['TEXT', 'JSON_SCHEMA']),
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
                z
                  .object({
                    key: z.string().min(1).max(80),
                    value: jsonValueSchema,
                  })
                  .strict(),
              ),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

export const playgroundBuiltPreviewSchema = z
  .object({
    status: z.literal('BUILT'),
    agent: playgroundAgentSchema,
    retention: z.literal('EPHEMERAL'),
    versions: versionsSchema,
    pipeline: z.array(pipelineNodeSchema).length(7),
    sections: z.array(sectionSchema),
    trustBoundaries: trustBoundariesSchema,
    prompt: z.object({ instructions: z.string(), input: z.string() }).strict(),
    budget: budgetSchema,
    knowledge: knowledgeSchema,
    hashes: hashesSchema,
    outputContract: outputContractSchema,
  })
  .strict();
export type PlaygroundBuiltPreview = z.infer<typeof playgroundBuiltPreviewSchema>;

export const playgroundRejectedPreviewSchema = z
  .object({
    status: z.literal('REJECTED'),
    agent: playgroundAgentSchema,
    retention: z.literal('EPHEMERAL'),
    pipeline: z.array(pipelineNodeSchema).length(7),
    error: z
      .object({
        code: z.string().min(1).max(128),
        stage: playgroundPipelineStageSchema,
        message: z.string().trim().min(1).max(500),
      })
      .strict(),
  })
  .strict();
export const playgroundPreviewSchema = z.discriminatedUnion('status', [
  playgroundBuiltPreviewSchema,
  playgroundRejectedPreviewSchema,
]);
export type PlaygroundPreview = z.infer<typeof playgroundPreviewSchema>;

export const playgroundValidationStageSchema = z.enum([
  'RESPONSE_VALIDATOR',
  'JSON_SCHEMA',
  'AGENT_CONTRACT',
  'BUSINESS_VALIDATION',
]);
export type PlaygroundValidationStage = z.infer<typeof playgroundValidationStageSchema>;
export const playgroundValidationStatusSchema = z.enum(['PASS', 'FAIL', 'NOT_RUN']);
export type PlaygroundValidationStatus = z.infer<typeof playgroundValidationStatusSchema>;
const validationIssueSchema = z
  .object({
    code: z.string().min(1).max(128),
    path: z.array(z.union([z.string().max(256), z.number().int().nonnegative()])).max(32),
    keyword: z.string().min(1).max(128).nullable(),
    message: z.string().trim().min(1).max(500),
  })
  .strict();
export const playgroundValidationSchema = z
  .object({
    status: z.enum(['PASS', 'FAIL']),
    agent: playgroundAgentSchema,
    retention: z.literal('EPHEMERAL'),
    candidateHash: hashSchema,
    contract: outputContractSchema,
    stages: z
      .array(
        z
          .object({
            stage: playgroundValidationStageSchema,
            status: playgroundValidationStatusSchema,
            issues: z.array(validationIssueSchema).max(100),
            issuesTruncated: z.boolean(),
          })
          .strict(),
      )
      .length(4),
  })
  .strict();
export type PlaygroundValidation = z.infer<typeof playgroundValidationSchema>;

const responseMetadataSchema = z
  .object({
    requestId: z.string().regex(/^request-[0-9a-f-]{36}$/),
    apiVersion: semanticVersionSchema,
  })
  .strict();
export function playgroundSuccessEnvelopeSchema<Data extends z.ZodType>(data: Data) {
  return z
    .object({
      success: z.literal(true),
      data,
      metadata: responseMetadataSchema,
      errors: z.tuple([]),
    })
    .strict();
}
export const playgroundErrorEnvelopeSchema = z
  .object({
    success: z.literal(false),
    data: z.null(),
    metadata: responseMetadataSchema,
    errors: z
      .array(
        z
          .object({
            code: z.string().min(1).max(160),
            message: z.string().min(1).max(300),
            path: z.string().min(1).max(256).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
