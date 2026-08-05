import {
  agentRunMetricsSchema,
  agentRunOutputSchema,
  promptMetadataSchema,
  providerMetadataSchema,
} from '@brq/agent-runner';
import { artifactGenerationMetadataSchema, generatedArtifactSchema } from '@brq/artifact-generator';
import {
  knowledgeCategorySchema,
  knowledgeContextBudgetSchema,
  knowledgeDocumentIdSchema,
  knowledgeHashSchema,
  knowledgeSourceIdSchema,
} from '@brq/knowledge-loader';
import { validationIssueSchema, validationMetadataSchema } from '@brq/response-validator';
import { identifierSchema, semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

import {
  PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES,
  PRODUCT_OWNER_BUSINESS_VALIDATION_MAX_ISSUES,
  PRODUCT_OWNER_READINESS_VALUES,
  validateProductOwnerBusinessRules,
} from './business-validation';
import { PRODUCT_OWNER_CONTRACT_LIMITS } from './limits';

const { collections, request, specification } = PRODUCT_OWNER_CONTRACT_LIMITS;

function boundedText(maximum: number) {
  return z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, 'O texto não pode conter apenas espaços.')
    .refine((value) => value === value.trim(), 'O texto não pode ser normalizado silenciosamente.');
}

function prefixedId(prefix: string) {
  return z.string().regex(new RegExp(`^${prefix}-[0-9]{3}$`));
}

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const impactSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
const PRODUCT_OWNER_ARTIFACT_IDENTITIES = [
  {
    filename: 'story.md',
    name: 'Product Owner Story',
    type: 'PRODUCT_OWNER_STORY',
    templateId: 'artifact:product-owner-story',
    format: 'TEXT',
    mediaType: 'text/markdown',
  },
  {
    filename: 'acceptance.md',
    name: 'Product Owner Acceptance',
    type: 'PRODUCT_OWNER_ACCEPTANCE',
    templateId: 'artifact:product-owner-acceptance',
    format: 'TEXT',
    mediaType: 'text/markdown',
  },
  {
    filename: 'backlog.json',
    name: 'Product Owner Backlog',
    type: 'PRODUCT_OWNER_BACKLOG',
    templateId: 'artifact:product-owner-backlog',
    format: 'JSON',
    mediaType: 'application/json',
  },
] as const;

function addMismatch(
  context: z.core.$RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  context.addIssue({ code: 'custom', path: [...path], message });
}

export const productOwnerReadinessSchema = z.enum(PRODUCT_OWNER_READINESS_VALUES);
export const productOwnerAgentOutcomeSchema = z.enum(['GENERATED', 'VALIDATION_REJECTED']);

export const productOwnerAgentContextSchema = z
  .object({
    executionId: identifierSchema,
    agentExecutionId: identifierSchema,
    attempt: z.number().int().positive(),
    agentVersion: semanticVersionSchema,
    requestId: identifierSchema.optional(),
    traceId: identifierSchema.optional(),
  })
  .strict();

export const productOwnerDemandSchema = z
  .object({
    title: boundedText(request.demandTitleCharacters),
    description: boundedText(request.demandDescriptionCharacters),
    businessGoal: boundedText(request.businessGoalCharacters).optional(),
    targetUsers: z
      .array(boundedText(request.targetUserCharacters))
      .max(request.targetUsers)
      .optional(),
    constraints: z
      .array(boundedText(request.constraintCharacters))
      .max(request.constraints)
      .optional(),
    deadline: z.iso.date().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  })
  .strict();

export const productOwnerAgentLimitsSchema = z
  .object({
    knowledgeMaxDocuments: z.number().int().positive().max(request.knowledgeDocuments).optional(),
    knowledgeMaxBytes: z.number().int().positive().max(request.knowledgeBytes).optional(),
    promptMaxBytes: z.number().int().positive().max(request.promptBytes).optional(),
    maxOutputTokens: z.number().int().positive().max(request.maxOutputTokens).optional(),
    timeoutMs: z.number().int().min(1_000).max(request.timeoutMs).optional(),
  })
  .strict();

export const productOwnerAgentRequestSchema = z
  .object({
    context: productOwnerAgentContextSchema,
    demand: productOwnerDemandSchema,
    additionalContext: boundedText(request.additionalContextCharacters).optional(),
    model: boundedText(request.modelCharacters),
    limits: productOwnerAgentLimitsSchema.optional(),
  })
  .strict();

export const productOwnerUserStorySchema = z
  .object({
    asA: boundedText(specification.userStoryPartCharacters),
    iWant: boundedText(specification.userStoryPartCharacters),
    soThat: boundedText(specification.userStoryPartCharacters),
  })
  .strict();

export const productOwnerAcceptanceCriterionSchema = z
  .object({
    id: prefixedId('AC'),
    given: boundedText(specification.itemDescriptionCharacters),
    when: boundedText(specification.itemDescriptionCharacters),
    then: boundedText(specification.itemDescriptionCharacters),
  })
  .strict();

export const productOwnerBusinessRuleSchema = z
  .object({
    id: prefixedId('BR'),
    description: boundedText(specification.itemDescriptionCharacters),
    source: boundedText(specification.itemDescriptionCharacters).nullable(),
    condition: boundedText(specification.itemDescriptionCharacters).nullable(),
    impact: impactSchema,
  })
  .strict();

const acceptanceCriterionReferenceSchema = prefixedId('AC');
const dependencyReferenceSchema = prefixedId('DEP');
const scenarioStepSchema = boundedText(specification.itemDescriptionCharacters);

export const productOwnerScenarioSchema = z
  .object({
    id: prefixedId('SCN'),
    title: boundedText(specification.itemTitleCharacters),
    type: z.enum(['MAIN', 'ALTERNATIVE', 'ERROR']),
    given: z.array(scenarioStepSchema).min(1).max(specification.scenarioSteps),
    when: z.array(scenarioStepSchema).min(1).max(specification.scenarioSteps),
    then: z.array(scenarioStepSchema).min(1).max(specification.scenarioSteps),
    acceptanceCriteriaIds: z
      .array(acceptanceCriterionReferenceSchema)
      .max(collections.acceptanceCriteria),
  })
  .strict();

export const productOwnerAssumptionSchema = z
  .object({
    id: prefixedId('ASM'),
    description: boundedText(specification.itemDescriptionCharacters),
    requiresValidation: z.boolean(),
  })
  .strict();

export const productOwnerDependencySchema = z
  .object({
    id: prefixedId('DEP'),
    description: boundedText(specification.itemDescriptionCharacters),
  })
  .strict();

export const productOwnerRiskSchema = z
  .object({
    id: prefixedId('RSK'),
    description: boundedText(specification.itemDescriptionCharacters),
    impact: impactSchema,
    mitigation: boundedText(specification.itemDescriptionCharacters).nullable(),
  })
  .strict();

export const productOwnerOpenQuestionSchema = z
  .object({
    id: prefixedId('Q'),
    question: boundedText(specification.itemDescriptionCharacters),
    impact: z.enum(['BLOCKING', 'NON_BLOCKING']),
  })
  .strict();

export const productOwnerOutOfScopeItemSchema = z
  .object({
    id: prefixedId('OOS'),
    description: boundedText(specification.itemDescriptionCharacters),
  })
  .strict();

export const productOwnerDefinitionOfReadyItemSchema = z
  .object({
    id: prefixedId('DOR'),
    criterion: boundedText(specification.itemDescriptionCharacters),
  })
  .strict();

export const productOwnerBacklogItemSchema = z
  .object({
    id: prefixedId('BL'),
    title: boundedText(specification.itemTitleCharacters),
    description: boundedText(specification.backlogDescriptionCharacters),
    priority: prioritySchema,
    dependencyIds: z.array(dependencyReferenceSchema).max(collections.dependencies),
    acceptanceCriteriaIds: z
      .array(acceptanceCriterionReferenceSchema)
      .max(collections.acceptanceCriteria),
  })
  .strict();

export const productOwnerSpecificationStructureSchema = z
  .object({
    readiness: productOwnerReadinessSchema,
    title: boundedText(specification.titleCharacters),
    summary: boundedText(specification.summaryCharacters),
    objective: boundedText(specification.objectiveCharacters),
    context: boundedText(specification.contextCharacters),
    userStory: productOwnerUserStorySchema.nullable(),
    acceptanceCriteria: z
      .array(productOwnerAcceptanceCriterionSchema)
      .max(collections.acceptanceCriteria),
    businessRules: z.array(productOwnerBusinessRuleSchema).max(collections.businessRules),
    scenarios: z.array(productOwnerScenarioSchema).max(collections.scenarios),
    assumptions: z.array(productOwnerAssumptionSchema).max(collections.assumptions),
    dependencies: z.array(productOwnerDependencySchema).max(collections.dependencies),
    risks: z.array(productOwnerRiskSchema).max(collections.risks),
    openQuestions: z.array(productOwnerOpenQuestionSchema).max(collections.openQuestions),
    outOfScope: z.array(productOwnerOutOfScopeItemSchema).max(collections.outOfScope),
    definitionOfReady: z
      .array(productOwnerDefinitionOfReadyItemSchema)
      .max(collections.definitionOfReady),
    backlogItems: z.array(productOwnerBacklogItemSchema).max(collections.backlogItems),
  })
  .strict();

export const productOwnerSpecificationSchema = productOwnerSpecificationStructureSchema.superRefine(
  (value, context) => {
    const businessValidation = validateProductOwnerBusinessRules(value);
    for (const issue of businessValidation.issues) {
      context.addIssue({ code: 'custom', path: [...issue.path], message: issue.message });
    }
  },
);

export const productOwnerBusinessValidationIssueCodeSchema = z.enum(
  Object.values(PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES),
);

export const productOwnerBusinessValidationIssueSchema = z
  .object({
    code: productOwnerBusinessValidationIssueCodeSchema,
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])).max(32),
    message: boundedText(500),
  })
  .strict();

export const productOwnerBusinessValidationResultSchema = z
  .object({
    valid: z.boolean(),
    expectedReadiness: productOwnerReadinessSchema.nullable(),
    issues: z
      .array(productOwnerBusinessValidationIssueSchema)
      .max(PRODUCT_OWNER_BUSINESS_VALIDATION_MAX_ISSUES),
    issuesTruncated: z.boolean(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.valid !== (result.issues.length === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['valid'],
        message: 'valid deve corresponder à ausência de issues de negócio.',
      });
    }
    if (result.valid && result.expectedReadiness === null) {
      context.addIssue({
        code: 'custom',
        path: ['expectedReadiness'],
        message: 'Business Validation válida exige readiness derivada.',
      });
    }
    if (result.valid && result.issuesTruncated) {
      context.addIssue({
        code: 'custom',
        path: ['issuesTruncated'],
        message: 'Uma Business Validation válida não pode possuir issues truncados.',
      });
    }
    if (
      result.issuesTruncated &&
      result.issues.length !== PRODUCT_OWNER_BUSINESS_VALIDATION_MAX_ISSUES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['issuesTruncated'],
        message: 'issuesTruncated exige que o limite público de issues tenha sido atingido.',
      });
    }
  });

export const productOwnerAssetReferenceSchema = z
  .object({
    id: identifierSchema,
    version: semanticVersionSchema,
    hash: hashSchema,
  })
  .strict();

export const productOwnerAssetsMetadataSchema = z
  .object({
    bundleHash: hashSchema,
    manifest: productOwnerAssetReferenceSchema,
    template: productOwnerAssetReferenceSchema,
    ruleSets: z.array(productOwnerAssetReferenceSchema).length(3),
    outputContract: productOwnerAssetReferenceSchema,
    validationContract: productOwnerAssetReferenceSchema,
    artifactSpecification: productOwnerAssetReferenceSchema,
  })
  .strict();

export const productOwnerKnowledgeMetadataSchema = z
  .object({
    context: z.literal('PRODUCT_OWNER'),
    sourceId: knowledgeSourceIdSchema,
    manifestVersion: semanticVersionSchema,
    policyVersion: semanticVersionSchema,
    contextHash: knowledgeHashSchema,
    documents: z.array(
      z
        .object({
          id: knowledgeDocumentIdSchema,
          category: knowledgeCategorySchema,
          hash: knowledgeHashSchema,
        })
        .strict(),
    ),
    budget: knowledgeContextBudgetSchema,
  })
  .strict();

export const productOwnerRunMetadataSchema = z
  .object({
    prompt: promptMetadataSchema,
    provider: providerMetadataSchema,
    metrics: agentRunMetricsSchema,
    responseHash: agentRunOutputSchema.shape.responseHash,
    finishReason: agentRunOutputSchema.shape.finishReason,
  })
  .strict()
  .superRefine((run, context) => {
    if (run.prompt.metadata.agent !== 'PRODUCT_OWNER') {
      context.addIssue({
        code: 'custom',
        path: ['prompt', 'metadata', 'agent'],
        message: 'O prompt deve pertencer ao Product Owner Agent.',
      });
    }
  });

export const productOwnerResponseValidationSummarySchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(validationIssueSchema),
    metadata: validationMetadataSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const hasError = result.issues.some((issue) => issue.severity === 'ERROR');
    if (result.valid === hasError) {
      context.addIssue({
        code: 'custom',
        path: ['valid'],
        message: 'O resumo deve preservar a coerência do Response Validator.',
      });
    }
  });

const resultMetadataBase = {
  assets: productOwnerAssetsMetadataSchema,
  knowledge: productOwnerKnowledgeMetadataSchema,
  run: productOwnerRunMetadataSchema,
};

const generatedResultSchema = z
  .object({
    outcome: z.literal('GENERATED'),
    context: productOwnerAgentContextSchema,
    readiness: productOwnerReadinessSchema,
    specification: productOwnerSpecificationSchema,
    artifacts: z.array(generatedArtifactSchema).length(3),
    validation: z
      .object({
        response: productOwnerResponseValidationSummarySchema.safeExtend({
          valid: z.literal(true),
        }),
        business: productOwnerBusinessValidationResultSchema.safeExtend({ valid: z.literal(true) }),
      })
      .strict(),
    metadata: z
      .object({
        ...resultMetadataBase,
        generation: artifactGenerationMetadataSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((result, context) => {
    result.artifacts.forEach((artifact, index) => {
      const expected = PRODUCT_OWNER_ARTIFACT_IDENTITIES[index];
      if (expected === undefined) return;

      const checks = [
        ['draft', 'filename', artifact.draft.filename, expected.filename],
        ['draft', 'name', artifact.draft.name, expected.name],
        ['draft', 'type', artifact.draft.type, expected.type],
        ['metadata', 'templateId', artifact.metadata.templateId, expected.templateId],
        ['metadata', 'format', artifact.metadata.format, expected.format],
        ['metadata', 'mediaType', artifact.metadata.mediaType, expected.mediaType],
      ] as const;

      for (const [scope, field, actual, expectedValue] of checks) {
        if (actual !== expectedValue) {
          addMismatch(
            context,
            ['artifacts', index, scope, field],
            'O artifact deve preservar a identidade e a ordem canônicas do Product Owner.',
          );
        }
      }
    });

    if (result.readiness !== result.specification.readiness) {
      context.addIssue({
        code: 'custom',
        path: ['readiness'],
        message: 'readiness deve corresponder à especificação.',
      });
    }
    if (result.validation.business.expectedReadiness !== result.readiness) {
      context.addIssue({
        code: 'custom',
        path: ['validation', 'business', 'expectedReadiness'],
        message: 'A readiness observada deve corresponder à Business Validation.',
      });
    }
    if (result.metadata.generation.artifactCount !== result.artifacts.length) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'generation', 'artifactCount'],
        message: 'artifactCount deve corresponder aos artifacts retornados.',
      });
    }
    const totalBytes = result.artifacts.reduce(
      (total, artifact) => total + artifact.metadata.byteLength,
      0,
    );
    if (result.metadata.generation.totalBytes !== totalBytes) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'generation', 'totalBytes'],
        message: 'totalBytes deve corresponder à soma dos artifacts retornados.',
      });
    }
  });

const validationRejectedResultSchema = z
  .object({
    outcome: z.literal('VALIDATION_REJECTED'),
    rejectedAt: z.enum(['RESPONSE_VALIDATION', 'BUSINESS_VALIDATION']),
    context: productOwnerAgentContextSchema,
    readiness: z.null(),
    specification: z.null(),
    artifacts: z.array(generatedArtifactSchema).max(0),
    validation: z
      .object({
        response: productOwnerResponseValidationSummarySchema,
        business: productOwnerBusinessValidationResultSchema.nullable(),
      })
      .strict(),
    metadata: z
      .object({
        ...resultMetadataBase,
        generation: z.null(),
      })
      .strict(),
  })
  .strict()
  .superRefine((result, context) => {
    const responseRejected =
      result.rejectedAt === 'RESPONSE_VALIDATION' &&
      !result.validation.response.valid &&
      result.validation.business === null;
    const businessRejected =
      result.rejectedAt === 'BUSINESS_VALIDATION' &&
      result.validation.response.valid &&
      result.validation.business?.valid === false;

    if (!responseRejected && !businessRejected) {
      context.addIssue({
        code: 'custom',
        path: ['validation'],
        message: 'O resultado rejeitado deve identificar a etapa funcional que o rejeitou.',
      });
    }
  });

export const productOwnerAgentResultSchema = z
  .discriminatedUnion('outcome', [generatedResultSchema, validationRejectedResultSchema])
  .superRefine((result, context) => {
    const { assets, run } = result.metadata;
    const responseMetadata = result.validation.response.metadata;
    const source = responseMetadata.source;

    const lineageChecks = [
      [['context', 'executionId'], result.context.executionId, source.executionId],
      [['context', 'agentExecutionId'], result.context.agentExecutionId, source.agentExecutionId],
      [['context', 'requestId'], result.context.requestId, source.requestId],
      [['context', 'traceId'], result.context.traceId, source.traceId],
      [['metadata', 'run', 'provider', 'provider'], run.provider.provider, source.provider],
      [['metadata', 'run', 'provider', 'responseModel'], run.provider.responseModel, source.model],
      [['metadata', 'run', 'responseHash'], run.responseHash, source.responseHash],
      [['metadata', 'run', 'finishReason'], run.finishReason, source.finishReason],
      [
        ['metadata', 'run', 'prompt', 'metadata', 'promptHash'],
        run.prompt.metadata.promptHash,
        source.promptHash,
      ],
      [
        ['metadata', 'run', 'prompt', 'metadata', 'outputContractHash'],
        run.prompt.metadata.outputContractHash,
        source.outputContractHash,
      ],
      [['metadata', 'assets', 'template', 'id'], assets.template.id, run.prompt.metadata.promptId],
      [
        ['metadata', 'assets', 'template', 'version'],
        assets.template.version,
        run.prompt.metadata.version,
      ],
      [
        ['metadata', 'assets', 'template', 'hash'],
        assets.template.hash,
        run.prompt.metadata.templateHash,
      ],
      [
        ['metadata', 'assets', 'outputContract', 'hash'],
        assets.outputContract.hash,
        run.prompt.metadata.outputContractHash,
      ],
      [
        ['metadata', 'assets', 'outputContract', 'id'],
        assets.outputContract.id,
        assets.validationContract.id,
      ],
      [
        ['metadata', 'assets', 'outputContract', 'version'],
        assets.outputContract.version,
        assets.validationContract.version,
      ],
      [
        ['metadata', 'assets', 'validationContract', 'id'],
        assets.validationContract.id,
        responseMetadata.contract.id,
      ],
      [
        ['metadata', 'assets', 'validationContract', 'version'],
        assets.validationContract.version,
        responseMetadata.contract.version,
      ],
      [
        ['metadata', 'assets', 'validationContract', 'hash'],
        assets.validationContract.hash,
        responseMetadata.contract.contractHash,
      ],
    ] as const;

    for (const [path, actual, expected] of lineageChecks) {
      if (actual !== expected) {
        addMismatch(
          context,
          path,
          'Os metadados de proveniência devem preservar a mesma execução.',
        );
      }
    }

    if (run.prompt.metadata.ruleSetHashes.length !== assets.ruleSets.length) {
      addMismatch(
        context,
        ['metadata', 'run', 'prompt', 'metadata', 'ruleSetHashes'],
        'A proveniência do prompt deve conter os três rule sets do bundle.',
      );
    }
    assets.ruleSets.forEach((asset, assetIndex) => {
      const promptRuleSetIndex = run.prompt.metadata.ruleSetHashes.findIndex(
        (ruleSet) => ruleSet.ruleSetId === asset.id,
      );
      const promptRuleSet = run.prompt.metadata.ruleSetHashes[promptRuleSetIndex];
      if (promptRuleSet === undefined) {
        addMismatch(
          context,
          ['metadata', 'run', 'prompt', 'metadata', 'ruleSetHashes', assetIndex],
          'A proveniência do prompt deve conter cada rule set do bundle.',
        );
        return;
      }

      const checks = [
        ['ruleSetId', promptRuleSet.ruleSetId, asset.id],
        ['version', promptRuleSet.version, asset.version],
        ['hash', promptRuleSet.hash, asset.hash],
      ] as const;
      for (const [field, actual, expected] of checks) {
        if (actual !== expected) {
          addMismatch(
            context,
            ['metadata', 'run', 'prompt', 'metadata', 'ruleSetHashes', promptRuleSetIndex, field],
            'A proveniência do rule set deve corresponder ao bundle validado.',
          );
        }
      }
    });

    const promptContexts = run.prompt.metadata.contextHashes;
    const knowledgeContexts = promptContexts.filter(
      (promptContext) => promptContext.kind === 'KNOWLEDGE',
    );
    const requestContexts = promptContexts.filter(
      (promptContext) => promptContext.kind === 'USER_INPUT',
    );
    if (
      promptContexts.length !== 2 ||
      knowledgeContexts.length !== 1 ||
      requestContexts.length !== 1
    ) {
      addMismatch(
        context,
        ['metadata', 'run', 'prompt', 'metadata', 'contextHashes'],
        'A proveniência deve conter exatamente os contextos de knowledge e request.',
      );
    }

    const knowledgeContext = knowledgeContexts[0];
    if (knowledgeContext !== undefined) {
      if (
        knowledgeContext.serialization !== 'TEXT' ||
        knowledgeContext.contentHash !== result.metadata.knowledge.contextHash
      ) {
        addMismatch(
          context,
          ['metadata', 'run', 'prompt', 'metadata', 'contextHashes'],
          'O contexto de knowledge do prompt deve corresponder ao contexto carregado.',
        );
      }
      if (knowledgeContext.references.length !== result.metadata.knowledge.documents.length) {
        addMismatch(
          context,
          ['metadata', 'run', 'prompt', 'metadata', 'contextHashes'],
          'As referências de knowledge devem corresponder aos documentos carregados.',
        );
      }
      result.metadata.knowledge.documents.forEach((document, index) => {
        const reference = knowledgeContext.references[index];
        if (
          reference === undefined ||
          reference.id !== document.id ||
          reference.category !== document.category ||
          reference.hash !== document.hash
        ) {
          addMismatch(
            context,
            ['metadata', 'run', 'prompt', 'metadata', 'contextHashes', index, 'references'],
            'A referência de knowledge deve preservar ID, categoria e hash do documento.',
          );
        }
      });
    }

    const requestContext = requestContexts[0];
    if (
      requestContext !== undefined &&
      (requestContext.serialization !== 'JSON' || requestContext.references.length !== 0)
    ) {
      addMismatch(
        context,
        ['metadata', 'run', 'prompt', 'metadata', 'contextHashes'],
        'O contexto do request deve permanecer JSON sem referências documentais.',
      );
    }

    if (result.outcome !== 'GENERATED') return;

    const generation = result.metadata.generation;
    const generationSource = generation.source;
    const generationChecks = [
      [
        ['metadata', 'generation', 'specificationId'],
        generation.specificationId,
        assets.artifactSpecification.id,
      ],
      [
        ['metadata', 'generation', 'specificationVersion'],
        generation.specificationVersion,
        assets.artifactSpecification.version,
      ],
      [
        ['metadata', 'generation', 'specificationHash'],
        generation.specificationHash,
        assets.artifactSpecification.hash,
      ],
      [
        ['metadata', 'generation', 'source', 'executionId'],
        generationSource.executionId,
        source.executionId,
      ],
      [
        ['metadata', 'generation', 'source', 'agentExecutionId'],
        generationSource.agentExecutionId,
        source.agentExecutionId,
      ],
      [
        ['metadata', 'generation', 'source', 'requestId'],
        generationSource.requestId,
        source.requestId,
      ],
      [['metadata', 'generation', 'source', 'traceId'], generationSource.traceId, source.traceId],
      [
        ['metadata', 'generation', 'source', 'provider'],
        generationSource.provider,
        source.provider,
      ],
      [['metadata', 'generation', 'source', 'model'], generationSource.model, source.model],
      [
        ['metadata', 'generation', 'source', 'promptHash'],
        generationSource.promptHash,
        source.promptHash,
      ],
      [
        ['metadata', 'generation', 'source', 'outputContractHash'],
        generationSource.outputContractHash,
        source.outputContractHash,
      ],
      [
        ['metadata', 'generation', 'source', 'responseHash'],
        generationSource.responseHash,
        source.responseHash,
      ],
      [
        ['metadata', 'generation', 'source', 'finishReason'],
        generationSource.finishReason,
        source.finishReason,
      ],
      [
        ['metadata', 'generation', 'source', 'contractId'],
        generationSource.contractId,
        responseMetadata.contract.id,
      ],
      [
        ['metadata', 'generation', 'source', 'contractVersion'],
        generationSource.contractVersion,
        responseMetadata.contract.version,
      ],
      [
        ['metadata', 'generation', 'source', 'contractFormat'],
        generationSource.contractFormat,
        responseMetadata.contract.format,
      ],
      [
        ['metadata', 'generation', 'source', 'contractHash'],
        generationSource.contractHash,
        responseMetadata.contract.contractHash,
      ],
      [
        ['metadata', 'generation', 'source', 'validationHash'],
        generationSource.validationHash,
        responseMetadata.validationHash,
      ],
      [
        ['metadata', 'generation', 'source', 'validatedValueHash'],
        generationSource.validatedValueHash,
        responseMetadata.validatedValueHash,
      ],
    ] as const;

    for (const [path, actual, expected] of generationChecks) {
      if (actual !== expected) {
        addMismatch(
          context,
          path,
          'A geração deve preservar a proveniência da validação recebida.',
        );
      }
    }
  });
