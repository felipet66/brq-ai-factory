import {
  agentRunMetricsSchema,
  agentRunOutputSchema,
  promptMetadataSchema,
  providerMetadataSchema,
} from '@brq/agent-runner';
import { artifactGenerationMetadataSchema, generatedArtifactSchema } from '@brq/artifact-generator';
import { developerReadinessSchema, technicalSpecificationSchema } from '@brq/developer-agent';
import {
  knowledgeCategorySchema,
  knowledgeContextBudgetSchema,
  knowledgeDocumentIdSchema,
  knowledgeHashSchema,
  knowledgeSourceIdSchema,
} from '@brq/knowledge-loader';
import {
  productOwnerReadinessSchema,
  productOwnerSpecificationSchema,
} from '@brq/product-owner-agent';
import { validationIssueSchema, validationMetadataSchema } from '@brq/response-validator';
import { identifierSchema, semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import { deliveryIntentSchema } from '@brq/shared/schemas/delivery-intent.schema';
import { z } from 'zod';

import {
  QA_BUSINESS_VALIDATION_ISSUE_CODES,
  QA_BUSINESS_VALIDATION_MAX_ISSUES,
  QA_READINESS_VALUES,
  deriveQAReadiness,
} from './business-validation';
import { QA_CONTRACT_LIMITS } from './limits';

const { collections, nested, request, specification } = QA_CONTRACT_LIMITS;

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

function addMismatch(
  context: z.core.$RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  context.addIssue({ code: 'custom', path: [...path], message });
}

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const scenarioReferenceSchema = z.string().regex(/^QA(?:P|N|E)-[0-9]{3}$/);
const functionalReferenceSchema = z.string().regex(/^(?:AC|BR)-[0-9]{3}$/);
const technicalReferenceSchema = z
  .string()
  .regex(/^(?:CMP|MOD|FLW|CTR|API|EVT|ENT|REL|DEC|DOD)-[0-9]{3}$/);
const sourceReferenceSchema = z.union([functionalReferenceSchema, technicalReferenceSchema]);
const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const testTypeSchema = z.enum([
  'UNIT',
  'INTEGRATION',
  'CONTRACT',
  'API',
  'END_TO_END',
  'SECURITY',
  'PERFORMANCE',
  'ACCESSIBILITY',
  'USABILITY',
  'REGRESSION',
  'MANUAL',
  'OTHER',
]);
const boundedItemArray = z.array(boundedText(specification.itemCharacters)).max(nested.listItems);

export const qaReadinessSchema = z.enum(QA_READINESS_VALUES);
export const qaAgentOutcomeSchema = z.enum(['GENERATED', 'VALIDATION_REJECTED']);

export const qaAgentContextSchema = z
  .object({
    executionId: identifierSchema,
    agentExecutionId: identifierSchema,
    attempt: z.number().int().positive(),
    agentVersion: semanticVersionSchema,
    requestId: identifierSchema.optional(),
    traceId: identifierSchema.optional(),
  })
  .strict();

export const qaAgentLimitsSchema = z
  .object({
    knowledgeMaxDocuments: z.number().int().positive().max(request.knowledgeDocuments).optional(),
    knowledgeMaxBytes: z.number().int().positive().max(request.knowledgeBytes).optional(),
    promptMaxBytes: z.number().int().positive().max(request.promptBytes).optional(),
    maxOutputTokens: z.number().int().positive().max(request.maxOutputTokens).optional(),
    timeoutMs: z.number().int().min(1_000).max(request.timeoutMs).optional(),
  })
  .strict();

export const qaAgentRequestSchema = z
  .object({
    context: qaAgentContextSchema,
    productOwnerSpecification: productOwnerSpecificationSchema,
    technicalSpecification: technicalSpecificationSchema,
    deliveryIntent: deliveryIntentSchema,
    model: boundedText(request.modelCharacters),
    limits: qaAgentLimitsSchema.optional(),
  })
  .strict();

export const qaTestStrategySchema = z
  .object({
    approach: boundedText(specification.descriptionCharacters),
    objectives: boundedItemArray,
    scope: boundedItemArray,
    outOfScope: boundedItemArray,
    testTypes: z.array(testTypeSchema).max(nested.testTypes),
    environments: boundedItemArray,
    preconditions: boundedItemArray,
    testDataGuidelines: boundedItemArray,
    entryCriteria: boundedItemArray,
    exitCriteria: boundedItemArray,
  })
  .strict();

function scenarioSchema(prefix: 'QAP' | 'QAN' | 'QAE') {
  return z
    .object({
      id: prefixedId(prefix),
      title: boundedText(specification.titleCharacters),
      objective: boundedText(specification.objectiveCharacters),
      priority: prioritySchema,
      testTypes: z.array(testTypeSchema).min(1).max(nested.testTypes),
      preconditions: boundedItemArray,
      testData: boundedItemArray,
      steps: z.array(boundedText(specification.itemCharacters)).min(1).max(nested.scenarioSteps),
      expectedResults: z
        .array(boundedText(specification.itemCharacters))
        .min(1)
        .max(nested.scenarioSteps),
      functionalReferences: z.array(functionalReferenceSchema).max(nested.references),
      technicalReferences: z.array(technicalReferenceSchema).max(nested.references),
      automationSuitability: z.enum(['RECOMMENDED', 'OPTIONAL', 'NOT_RECOMMENDED']),
      rationale: boundedText(specification.descriptionCharacters),
    })
    .strict();
}

export const qaPositiveScenarioSchema = scenarioSchema('QAP');
export const qaNegativeScenarioSchema = scenarioSchema('QAN');
export const qaEdgeCaseSchema = scenarioSchema('QAE');

export const qaCoverageSummaryItemSchema = z
  .object({
    total: z.number().int().nonnegative().max(200),
    covered: z.number().int().nonnegative().max(200),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.covered > value.total)
      addMismatch(context, ['covered'], 'covered não pode superar total.');
  });

export const qaCoverageSummarySchema = z
  .object({
    acceptanceCriteria: qaCoverageSummaryItemSchema,
    businessRules: qaCoverageSummaryItemSchema,
    technicalDecisions: qaCoverageSummaryItemSchema,
    definitionOfDone: qaCoverageSummaryItemSchema,
  })
  .strict();

export const qaFunctionalCoverageItemSchema = z
  .object({
    sourceId: functionalReferenceSchema,
    scenarioIds: z.array(scenarioReferenceSchema).min(1).max(nested.references),
  })
  .strict();

export const qaTechnicalCoverageItemSchema = z
  .object({
    sourceId: technicalReferenceSchema,
    scenarioIds: z.array(scenarioReferenceSchema).min(1).max(nested.references),
  })
  .strict();

export const qaTraceabilityRowSchema = z
  .object({
    id: prefixedId('QTR'),
    functionalSourceIds: z.array(functionalReferenceSchema).max(nested.references),
    technicalSourceIds: z.array(technicalReferenceSchema).max(nested.references),
    scenarioIds: z.array(scenarioReferenceSchema).min(1).max(nested.references),
  })
  .strict();

export const qaTraceabilitySchema = z
  .object({
    summary: qaCoverageSummarySchema,
    functionalCoverage: z.array(qaFunctionalCoverageItemSchema).max(collections.functionalCoverage),
    technicalCoverage: z.array(qaTechnicalCoverageItemSchema).max(collections.technicalCoverage),
    matrix: z.array(qaTraceabilityRowSchema).max(collections.traceability),
  })
  .strict();

export const qaRiskSchema = z
  .object({
    id: prefixedId('QRISK'),
    description: boundedText(specification.descriptionCharacters),
    impact: prioritySchema,
    likelihood: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    mitigation: boundedText(specification.descriptionCharacters).nullable(),
    scenarioIds: z.array(scenarioReferenceSchema).max(nested.references),
  })
  .strict();

export const qaApprovalCriterionSchema = z
  .object({
    id: prefixedId('QAPR'),
    criterion: boundedText(specification.itemCharacters),
    scenarioIds: z.array(scenarioReferenceSchema).min(1).max(nested.references),
  })
  .strict();

export const qaBlockingItemSchema = z
  .object({
    id: prefixedId('QBLK'),
    description: boundedText(specification.descriptionCharacters),
    sourceIds: z.array(sourceReferenceSchema).min(1).max(nested.references),
    resolution: boundedText(specification.descriptionCharacters),
  })
  .strict();

export const qaPriorityTestSchema = z
  .object({
    id: prefixedId('QPT'),
    rank: z.number().int().positive().max(180),
    scenarioId: scenarioReferenceSchema,
    rationale: boundedText(specification.descriptionCharacters),
  })
  .strict();

export const qaAutomationRecommendationSchema = z
  .object({
    id: prefixedId('QAUT'),
    scenarioIds: z.array(scenarioReferenceSchema).min(1).max(nested.references),
    target: testTypeSchema,
    priority: prioritySchema,
    rationale: boundedText(specification.descriptionCharacters),
    prerequisites: boundedItemArray,
  })
  .strict();

export const qaAssumptionSchema = z
  .object({
    id: prefixedId('QASM'),
    description: boundedText(specification.descriptionCharacters),
    requiresValidation: z.boolean(),
  })
  .strict();

export const qaOpenQuestionSchema = z
  .object({
    id: prefixedId('QQ'),
    question: boundedText(specification.descriptionCharacters),
    impact: z.enum(['BLOCKING', 'NON_BLOCKING']),
  })
  .strict();

export const qaOutOfScopeItemSchema = z
  .object({ id: prefixedId('QOOS'), description: boundedText(specification.descriptionCharacters) })
  .strict();

export const qaSpecificationStructureSchema = z
  .object({
    readiness: qaReadinessSchema,
    title: boundedText(specification.titleCharacters),
    summary: boundedText(specification.summaryCharacters),
    objective: boundedText(specification.objectiveCharacters),
    testStrategy: qaTestStrategySchema,
    traceability: qaTraceabilitySchema,
    positiveScenarios: z.array(qaPositiveScenarioSchema).max(collections.positiveScenarios),
    negativeScenarios: z.array(qaNegativeScenarioSchema).max(collections.negativeScenarios),
    edgeCases: z.array(qaEdgeCaseSchema).max(collections.edgeCases),
    risks: z.array(qaRiskSchema).max(collections.risks),
    approvalCriteria: z.array(qaApprovalCriterionSchema).max(collections.approvalCriteria),
    blockingItems: z.array(qaBlockingItemSchema).max(collections.blockingItems),
    priorityTests: z.array(qaPriorityTestSchema).max(collections.priorityTests),
    automationRecommendations: z
      .array(qaAutomationRecommendationSchema)
      .max(collections.automationRecommendations),
    assumptions: z.array(qaAssumptionSchema).max(collections.assumptions),
    openQuestions: z.array(qaOpenQuestionSchema).max(collections.openQuestions),
    outOfScope: z.array(qaOutOfScopeItemSchema).max(collections.outOfScope),
  })
  .strict();

export const qaSpecificationSchema = qaSpecificationStructureSchema;

export const qaBusinessValidationIssueCodeSchema = z.enum(
  Object.values(QA_BUSINESS_VALIDATION_ISSUE_CODES),
);
export const qaBusinessValidationIssueSchema = z
  .object({
    code: qaBusinessValidationIssueCodeSchema,
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])).max(32),
    message: boundedText(500),
  })
  .strict();
export const qaBusinessValidationResultSchema = z
  .object({
    valid: z.boolean(),
    expectedReadiness: qaReadinessSchema.nullable(),
    issues: z.array(qaBusinessValidationIssueSchema).max(QA_BUSINESS_VALIDATION_MAX_ISSUES),
    issuesTruncated: z.boolean(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.valid !== (result.issues.length === 0))
      addMismatch(context, ['valid'], 'valid deve corresponder à ausência de issues.');
    if (result.valid && result.expectedReadiness === null)
      addMismatch(context, ['expectedReadiness'], 'Uma validação válida exige readiness derivada.');
    if (result.valid && result.issuesTruncated)
      addMismatch(
        context,
        ['issuesTruncated'],
        'Uma validação válida não pode possuir issues truncados.',
      );
    if (result.issuesTruncated && result.issues.length !== QA_BUSINESS_VALIDATION_MAX_ISSUES)
      addMismatch(
        context,
        ['issuesTruncated'],
        'issuesTruncated exige o limite público de issues.',
      );
  });

export const qaAssetReferenceSchema = z
  .object({ id: identifierSchema, version: semanticVersionSchema, hash: hashSchema })
  .strict();
export const qaAssetsMetadataSchema = z
  .object({
    bundleHash: hashSchema,
    manifest: qaAssetReferenceSchema,
    template: qaAssetReferenceSchema,
    ruleSets: z.array(qaAssetReferenceSchema).length(3),
    outputContract: qaAssetReferenceSchema,
    validationContract: qaAssetReferenceSchema,
    artifactSpecification: qaAssetReferenceSchema,
  })
  .strict();
export const qaKnowledgeMetadataSchema = z
  .object({
    context: z.literal('QA'),
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
export const qaRunMetadataSchema = z
  .object({
    prompt: promptMetadataSchema,
    provider: providerMetadataSchema,
    metrics: agentRunMetricsSchema,
    responseHash: agentRunOutputSchema.shape.responseHash,
    finishReason: agentRunOutputSchema.shape.finishReason,
  })
  .strict()
  .superRefine((run, context) => {
    if (run.prompt.metadata.agent !== 'QA')
      addMismatch(context, ['prompt', 'metadata', 'agent'], 'O prompt deve pertencer ao QA Agent.');
  });
export const qaResponseValidationSummarySchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(validationIssueSchema),
    metadata: validationMetadataSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const hasError = result.issues.some((issue) => issue.severity === 'ERROR');
    if (result.valid === hasError)
      addMismatch(context, ['valid'], 'O resumo deve preservar a coerência do Response Validator.');
  });

const resultMetadataBase = {
  assets: qaAssetsMetadataSchema,
  knowledge: qaKnowledgeMetadataSchema,
  run: qaRunMetadataSchema,
  productOwnerSpecificationHash: knowledgeHashSchema,
  technicalSpecificationHash: knowledgeHashSchema,
  productOwnerReadiness: productOwnerReadinessSchema,
  technicalReadiness: developerReadinessSchema,
};

const QA_ARTIFACT_IDENTITIES = [
  {
    filename: 'test-plan.md',
    name: 'QA Test Plan',
    type: 'QA_TEST_PLAN',
    templateId: 'artifact:qa-test-plan',
    format: 'TEXT',
    mediaType: 'text/markdown',
  },
  {
    filename: 'traceability-matrix.json',
    name: 'QA Traceability Matrix',
    type: 'QA_TRACEABILITY_MATRIX',
    templateId: 'artifact:qa-traceability-matrix',
    format: 'JSON',
    mediaType: 'application/json',
  },
  {
    filename: 'qa-specification.md',
    name: 'QA Specification',
    type: 'QA_SPECIFICATION',
    templateId: 'artifact:qa-specification',
    format: 'TEXT',
    mediaType: 'text/markdown',
  },
] as const;

const generatedResultSchema = z
  .object({
    outcome: z.literal('GENERATED'),
    context: qaAgentContextSchema,
    readiness: qaReadinessSchema,
    specification: qaSpecificationSchema,
    artifacts: z.array(generatedArtifactSchema).length(3),
    validation: z
      .object({
        response: qaResponseValidationSummarySchema.safeExtend({ valid: z.literal(true) }),
        business: qaBusinessValidationResultSchema.safeExtend({ valid: z.literal(true) }),
      })
      .strict(),
    metadata: z
      .object({ ...resultMetadataBase, generation: artifactGenerationMetadataSchema })
      .strict(),
  })
  .strict()
  .superRefine((result, context) => {
    result.artifacts.forEach((artifact, index) => {
      const expected = QA_ARTIFACT_IDENTITIES[index];
      if (expected === undefined) return;
      for (const [scope, field, actual, value] of [
        ['draft', 'filename', artifact.draft.filename, expected.filename],
        ['draft', 'name', artifact.draft.name, expected.name],
        ['draft', 'type', artifact.draft.type, expected.type],
        ['metadata', 'templateId', artifact.metadata.templateId, expected.templateId],
        ['metadata', 'format', artifact.metadata.format, expected.format],
        ['metadata', 'mediaType', artifact.metadata.mediaType, expected.mediaType],
      ] as const) {
        if (actual !== value)
          addMismatch(
            context,
            ['artifacts', index, scope, field],
            'O artifact deve preservar a identidade e a ordem canônicas do QA.',
          );
      }
    });
    if (result.readiness !== result.specification.readiness)
      addMismatch(context, ['readiness'], 'readiness deve corresponder à especificação.');
    if (result.validation.business.expectedReadiness !== result.readiness)
      addMismatch(
        context,
        ['validation', 'business', 'expectedReadiness'],
        'readiness deve corresponder à Business Validation.',
      );
    const expectedReadiness = deriveQAReadiness(
      result.metadata.productOwnerReadiness,
      result.metadata.technicalReadiness,
      result.specification.openQuestions,
      result.specification.assumptions,
      result.specification.blockingItems,
    );
    if (expectedReadiness !== result.readiness)
      addMismatch(context, ['metadata'], 'readiness deve preservar as duas fontes.');
    if (result.metadata.generation.artifactCount !== result.artifacts.length)
      addMismatch(
        context,
        ['metadata', 'generation', 'artifactCount'],
        'artifactCount deve corresponder aos artifacts.',
      );
    const totalBytes = result.artifacts.reduce(
      (total, artifact) => total + artifact.metadata.byteLength,
      0,
    );
    if (result.metadata.generation.totalBytes !== totalBytes)
      addMismatch(
        context,
        ['metadata', 'generation', 'totalBytes'],
        'totalBytes deve corresponder aos artifacts.',
      );
  });

const validationRejectedResultSchema = z
  .object({
    outcome: z.literal('VALIDATION_REJECTED'),
    rejectedAt: z.enum(['RESPONSE_VALIDATION', 'BUSINESS_VALIDATION']),
    context: qaAgentContextSchema,
    readiness: z.null(),
    specification: z.null(),
    artifacts: z.array(generatedArtifactSchema).max(0),
    validation: z
      .object({
        response: qaResponseValidationSummarySchema,
        business: qaBusinessValidationResultSchema.nullable(),
      })
      .strict(),
    metadata: z.object({ ...resultMetadataBase, generation: z.null() }).strict(),
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
    if (!responseRejected && !businessRejected)
      addMismatch(context, ['validation'], 'O resultado deve identificar a etapa que o rejeitou.');
  });

export const qaAgentResultSchema = z
  .discriminatedUnion('outcome', [generatedResultSchema, validationRejectedResultSchema])
  .superRefine((result, context) => {
    const { assets, run } = result.metadata;
    const source = result.validation.response.metadata.source;
    const checks = [
      [['context', 'executionId'], result.context.executionId, source.executionId],
      [['context', 'agentExecutionId'], result.context.agentExecutionId, source.agentExecutionId],
      [['metadata', 'run', 'responseHash'], run.responseHash, source.responseHash],
      [['metadata', 'run', 'promptHash'], run.prompt.metadata.promptHash, source.promptHash],
      [['metadata', 'assets', 'template', 'id'], assets.template.id, run.prompt.metadata.promptId],
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
        ['metadata', 'assets', 'validationContract', 'hash'],
        assets.validationContract.hash,
        result.validation.response.metadata.contract.contractHash,
      ],
    ] as const;
    checks.forEach(([path, actual, expected]) => {
      if (actual !== expected)
        addMismatch(context, path, 'A proveniência deve preservar a mesma execução.');
    });
    const contexts = run.prompt.metadata.contextHashes;
    const knowledge = contexts.find(({ contextId }) => contextId === 'context:qa-knowledge');
    const productOwner = contexts.find(
      ({ contextId }) => contextId === 'context:qa-product-owner-specification',
    );
    const technical = contexts.find(
      ({ contextId }) => contextId === 'context:qa-technical-specification',
    );
    if (
      contexts.length !== 3 ||
      knowledge?.kind !== 'KNOWLEDGE' ||
      productOwner?.kind !== 'ARTIFACT' ||
      technical?.kind !== 'ARTIFACT'
    ) {
      addMismatch(
        context,
        ['metadata', 'run', 'prompt', 'metadata', 'contextHashes'],
        'A proveniência deve conter exatamente os três contextos do QA.',
      );
    }
    if (
      knowledge?.contentHash !== result.metadata.knowledge.contextHash ||
      productOwner?.contentHash !== result.metadata.productOwnerSpecificationHash ||
      technical?.contentHash !== result.metadata.technicalSpecificationHash
    ) {
      addMismatch(
        context,
        ['metadata', 'run', 'prompt', 'metadata', 'contextHashes'],
        'Os contextos devem preservar os hashes das fontes.',
      );
    }
    if (result.outcome === 'GENERATED') {
      const generation = result.metadata.generation;
      if (
        generation.specificationId !== assets.artifactSpecification.id ||
        generation.specificationVersion !== assets.artifactSpecification.version ||
        generation.specificationHash !== assets.artifactSpecification.hash ||
        generation.source.validationHash !== result.validation.response.metadata.validationHash ||
        generation.source.validatedValueHash !==
          result.validation.response.metadata.validatedValueHash
      ) {
        addMismatch(
          context,
          ['metadata', 'generation'],
          'A geração deve preservar a proveniência da validação e da specification.',
        );
      }
    }
  });
