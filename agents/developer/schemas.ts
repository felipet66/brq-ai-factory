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
import {
  productOwnerReadinessSchema,
  productOwnerSpecificationSchema,
} from '@brq/product-owner-agent';
import { validationIssueSchema, validationMetadataSchema } from '@brq/response-validator';
import { identifierSchema, semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import { deliveryIntentSchema } from '@brq/shared/schemas/delivery-intent.schema';
import { z } from 'zod';

import {
  DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES,
  DEVELOPER_BUSINESS_VALIDATION_MAX_ISSUES,
  DEVELOPER_READINESS_VALUES,
  deriveDeveloperReadiness,
} from './business-validation';
import { DEVELOPER_CONTRACT_LIMITS } from './limits';

const { collections, nested, request, specification } = DEVELOPER_CONTRACT_LIMITS;

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
const acceptanceCriterionReferenceSchema = prefixedId('AC');
const componentReferenceSchema = prefixedId('CMP');
const moduleReferenceSchema = prefixedId('MOD');
const flowReferenceSchema = prefixedId('FLW');
const contractReferenceSchema = prefixedId('CTR');
const apiReferenceSchema = prefixedId('API');
const eventReferenceSchema = prefixedId('EVT');
const entityReferenceSchema = prefixedId('ENT');
const phaseReferenceSchema = prefixedId('PH');
const planReferenceSchema = prefixedId('PLAN');
const backlogReferenceSchema = prefixedId('TBL');
const definitionOfDoneReferenceSchema = prefixedId('DOD');
const functionalSourceReferenceSchema = z.string().regex(/^(?:AC|BR|BL)-[0-9]{3}$/);

const relativeModulePathSchema = z
  .string()
  .min(1)
  .max(specification.pathCharacters)
  .superRefine((value, context) => {
    const segments = value.split('/');
    if (
      value !== value.trim() ||
      value !== value.normalize('NFC') ||
      value.startsWith('/') ||
      /^[A-Za-z]:/.test(value) ||
      value.includes('\\') ||
      /[\u0000-\u001f\u007f]/.test(value) ||
      segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'path deve ser relativo, normalizado e não pode conter travessia de diretório.',
      });
    }
  });

const apiPathSchema = z
  .string()
  .min(1)
  .max(specification.apiPathCharacters)
  .regex(/^\/(?:[^\s\u0000-\u001f\u007f]*)$/)
  .refine((value) => value === value.trim(), 'O path da API não pode ser normalizado.');

const changeTypeSchema = z.enum(['CREATE', 'MODIFY', 'DELETE']);
const dependencyStatusSchema = z.enum(['AVAILABLE', 'PLANNED', 'UNKNOWN']);

export const developerReadinessSchema = z.enum(DEVELOPER_READINESS_VALUES);
export const developerAgentOutcomeSchema = z.enum(['GENERATED', 'VALIDATION_REJECTED']);

export const developerAgentContextSchema = z
  .object({
    executionId: identifierSchema,
    agentExecutionId: identifierSchema,
    attempt: z.number().int().positive(),
    agentVersion: semanticVersionSchema,
    requestId: identifierSchema.optional(),
    traceId: identifierSchema.optional(),
  })
  .strict();

export const developerAgentLimitsSchema = z
  .object({
    knowledgeMaxDocuments: z.number().int().positive().max(request.knowledgeDocuments).optional(),
    knowledgeMaxBytes: z.number().int().positive().max(request.knowledgeBytes).optional(),
    promptMaxBytes: z.number().int().positive().max(request.promptBytes).optional(),
    maxOutputTokens: z.number().int().positive().max(request.maxOutputTokens).optional(),
    timeoutMs: z.number().int().min(1_000).max(request.timeoutMs).optional(),
  })
  .strict();

export const developerAgentRequestSchema = z
  .object({
    context: developerAgentContextSchema,
    productOwnerSpecification: productOwnerSpecificationSchema,
    deliveryIntent: deliveryIntentSchema,
    model: boundedText(request.modelCharacters),
    limits: developerAgentLimitsSchema.optional(),
  })
  .strict();

export const developerArchitectureSchema = z
  .object({
    overview: boundedText(specification.architectureCharacters),
    style: boundedText(specification.nameCharacters),
    rationale: boundedText(specification.descriptionCharacters),
    principles: z.array(boundedText(specification.itemCharacters)).max(nested.architecturePatterns),
    constraints: z
      .array(boundedText(specification.itemCharacters))
      .max(nested.architectureConstraints),
    qualityAttributes: z
      .array(boundedText(specification.itemCharacters))
      .max(nested.architecturePatterns),
    trustBoundaries: z
      .array(boundedText(specification.itemCharacters))
      .max(nested.architectureConstraints),
  })
  .strict();

export const developerComponentSchema = z
  .object({
    id: prefixedId('CMP'),
    name: boundedText(specification.nameCharacters),
    kind: z.enum([
      'APPLICATION',
      'SERVICE',
      'LIBRARY',
      'DATABASE',
      'INTEGRATION',
      'INFRASTRUCTURE',
      'DOCUMENTATION',
      'OTHER',
    ]),
    changeType: changeTypeSchema,
    responsibility: boundedText(specification.descriptionCharacters),
    moduleIds: z.array(moduleReferenceSchema).max(nested.moduleReferences),
    dependsOnComponentIds: z.array(componentReferenceSchema).max(nested.componentReferences),
  })
  .strict();

export const developerModuleSchema = z
  .object({
    id: prefixedId('MOD'),
    name: boundedText(specification.nameCharacters),
    path: relativeModulePathSchema,
    changeType: changeTypeSchema,
    responsibility: boundedText(specification.descriptionCharacters),
    componentId: componentReferenceSchema,
    dependsOnModuleIds: z.array(moduleReferenceSchema).max(nested.moduleReferences),
  })
  .strict();

export const developerFlowStepSchema = z
  .object({
    order: z.number().int().positive(),
    componentId: componentReferenceSchema,
    moduleId: moduleReferenceSchema.nullable(),
    action: boundedText(specification.actionCharacters),
  })
  .strict();

export const developerFlowSchema = z
  .object({
    id: prefixedId('FLW'),
    name: boundedText(specification.nameCharacters),
    description: boundedText(specification.descriptionCharacters),
    steps: z.array(developerFlowStepSchema).min(1).max(nested.flowSteps),
    acceptanceCriteriaIds: z.array(acceptanceCriterionReferenceSchema).max(nested.references),
  })
  .strict();

export const developerContractSchema = z
  .object({
    id: prefixedId('CTR'),
    name: boundedText(specification.nameCharacters),
    kind: z.enum(['REQUEST', 'RESPONSE', 'EVENT', 'INTERNAL', 'EXTERNAL']),
    description: boundedText(specification.descriptionCharacters),
    ownerComponentId: componentReferenceSchema,
    consumerComponentIds: z.array(componentReferenceSchema).max(nested.componentReferences),
  })
  .strict();

export const developerApiSchema = z
  .object({
    id: prefixedId('API'),
    name: boundedText(specification.nameCharacters),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']),
    path: apiPathSchema,
    description: boundedText(specification.descriptionCharacters),
    componentId: componentReferenceSchema,
    requestContractId: contractReferenceSchema.nullable(),
    responseContractId: contractReferenceSchema.nullable(),
    acceptanceCriteriaIds: z.array(acceptanceCriterionReferenceSchema).max(nested.references),
  })
  .strict();

export const developerEventSchema = z
  .object({
    id: prefixedId('EVT'),
    name: boundedText(specification.nameCharacters),
    description: boundedText(specification.descriptionCharacters),
    producerComponentId: componentReferenceSchema,
    consumerComponentIds: z.array(componentReferenceSchema).max(nested.componentReferences),
    payloadContractId: contractReferenceSchema.nullable(),
    acceptanceCriteriaIds: z.array(acceptanceCriterionReferenceSchema).max(nested.references),
  })
  .strict();

export const developerEntityFieldSchema = z
  .object({
    name: boundedText(specification.nameCharacters),
    type: boundedText(specification.fieldTypeCharacters),
    nullable: z.boolean(),
    description: boundedText(specification.descriptionCharacters),
  })
  .strict();

export const developerEntitySchema = z
  .object({
    id: prefixedId('ENT'),
    name: boundedText(specification.nameCharacters),
    description: boundedText(specification.descriptionCharacters),
    moduleId: moduleReferenceSchema.nullable(),
    fields: z.array(developerEntityFieldSchema).max(nested.entityFields),
  })
  .strict();

export const developerEntityRelationSchema = z
  .object({
    id: prefixedId('REL'),
    sourceEntityId: entityReferenceSchema,
    targetEntityId: entityReferenceSchema,
    kind: z.enum(['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY']),
    description: boundedText(specification.descriptionCharacters),
  })
  .strict();

export const developerDataModelSchema = z
  .object({
    changesRequired: z.boolean(),
    migrationRequired: z.boolean(),
    entities: z.array(developerEntitySchema).max(collections.entities),
    relations: z.array(developerEntityRelationSchema).max(collections.relations),
  })
  .strict();

export const developerInternalDependencySchema = z
  .object({
    id: prefixedId('IDEP'),
    name: boundedText(specification.nameCharacters),
    description: boundedText(specification.descriptionCharacters),
    componentId: componentReferenceSchema,
    status: dependencyStatusSchema,
    blocking: z.boolean(),
  })
  .strict();

export const developerExternalDependencySchema = z
  .object({
    id: prefixedId('EDEP'),
    name: boundedText(specification.nameCharacters),
    description: boundedText(specification.descriptionCharacters),
    componentId: componentReferenceSchema,
    kind: z.enum(['SERVICE', 'LIBRARY', 'PLATFORM', 'TEAM', 'DECISION', 'OTHER']),
    status: dependencyStatusSchema,
    blocking: z.boolean(),
  })
  .strict();

export const developerRiskSchema = z
  .object({
    id: prefixedId('TRSK'),
    description: boundedText(specification.descriptionCharacters),
    impact: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    likelihood: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    mitigation: boundedText(specification.descriptionCharacters).nullable(),
    componentIds: z.array(componentReferenceSchema).max(nested.componentReferences),
  })
  .strict();

export const developerImplementationPhaseSchema = z
  .object({
    id: prefixedId('PH'),
    order: z.number().int().positive(),
    name: boundedText(specification.nameCharacters),
    objective: boundedText(specification.objectiveCharacters),
    dependsOnPhaseIds: z.array(phaseReferenceSchema).max(collections.implementationPhases),
  })
  .strict();

export const developerImplementationPlanItemSchema = z
  .object({
    id: prefixedId('PLAN'),
    order: z.number().int().positive(),
    title: boundedText(specification.titleCharacters),
    description: boundedText(specification.descriptionCharacters),
    phaseId: phaseReferenceSchema,
    componentIds: z.array(componentReferenceSchema).max(nested.componentReferences),
    moduleIds: z.array(moduleReferenceSchema).max(nested.moduleReferences),
    dependsOnPlanItemIds: z.array(planReferenceSchema).max(collections.implementationPlan),
    acceptanceCriteriaIds: z.array(acceptanceCriterionReferenceSchema).max(nested.references),
  })
  .strict();

export const developerTechnicalBacklogItemSchema = z
  .object({
    id: prefixedId('TBL'),
    title: boundedText(specification.titleCharacters),
    description: boundedText(specification.descriptionCharacters),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    implementationPlanIds: z.array(planReferenceSchema).max(collections.implementationPlan),
    dependsOnBacklogItemIds: z.array(backlogReferenceSchema).max(collections.technicalBacklog),
    acceptanceCriteriaIds: z.array(acceptanceCriterionReferenceSchema).max(nested.references),
  })
  .strict();

export const developerDefinitionOfDoneItemSchema = z
  .object({
    id: prefixedId('DOD'),
    criterion: boundedText(specification.itemCharacters),
    acceptanceCriteriaIds: z.array(acceptanceCriterionReferenceSchema).max(nested.references),
  })
  .strict();

export const developerDecisionTradeOffSchema = z
  .object({
    benefit: boundedText(specification.itemCharacters),
    cost: boundedText(specification.itemCharacters),
  })
  .strict();

export const developerDecisionSchema = z
  .object({
    id: prefixedId('DEC'),
    title: boundedText(specification.titleCharacters),
    context: boundedText(specification.descriptionCharacters),
    decision: boundedText(specification.descriptionCharacters),
    alternatives: z.array(boundedText(specification.itemCharacters)).max(nested.alternatives),
    tradeOffs: z.array(developerDecisionTradeOffSchema).min(1).max(nested.tradeOffs),
    rationale: boundedText(specification.descriptionCharacters),
    requiresAdr: z.boolean(),
    componentIds: z.array(componentReferenceSchema).max(nested.componentReferences),
    moduleIds: z.array(moduleReferenceSchema).max(nested.moduleReferences),
  })
  .strict();

export const developerTraceabilityItemSchema = z
  .object({
    id: prefixedId('TRC'),
    sourceIds: z.array(functionalSourceReferenceSchema).min(1).max(nested.references),
    componentIds: z.array(componentReferenceSchema).max(nested.componentReferences),
    moduleIds: z.array(moduleReferenceSchema).max(nested.moduleReferences),
    flowIds: z.array(flowReferenceSchema).max(collections.flows),
    contractIds: z.array(contractReferenceSchema).max(collections.contracts),
    apiIds: z.array(apiReferenceSchema).max(collections.apis),
    eventIds: z.array(eventReferenceSchema).max(collections.events),
    implementationPlanIds: z.array(planReferenceSchema).max(collections.implementationPlan),
    technicalBacklogIds: z.array(backlogReferenceSchema).max(collections.technicalBacklog),
    definitionOfDoneIds: z.array(definitionOfDoneReferenceSchema).max(collections.definitionOfDone),
  })
  .strict();

export const developerAssumptionSchema = z
  .object({
    id: prefixedId('TASM'),
    description: boundedText(specification.descriptionCharacters),
    requiresValidation: z.boolean(),
  })
  .strict();

export const developerOpenQuestionSchema = z
  .object({
    id: prefixedId('TQ'),
    question: boundedText(specification.descriptionCharacters),
    impact: z.enum(['BLOCKING', 'NON_BLOCKING']),
  })
  .strict();

export const developerOutOfScopeItemSchema = z
  .object({
    id: prefixedId('TOOS'),
    description: boundedText(specification.descriptionCharacters),
  })
  .strict();

export const technicalSpecificationStructureSchema = z
  .object({
    readiness: developerReadinessSchema,
    title: boundedText(specification.titleCharacters),
    summary: boundedText(specification.summaryCharacters),
    objective: boundedText(specification.objectiveCharacters),
    complexity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']),
    estimatedStoryPoints: z.number().int().positive().max(specification.estimatedStoryPoints),
    architecture: developerArchitectureSchema,
    components: z.array(developerComponentSchema).max(collections.components),
    modules: z.array(developerModuleSchema).max(collections.modules),
    flows: z.array(developerFlowSchema).max(collections.flows),
    contracts: z.array(developerContractSchema).max(collections.contracts),
    apis: z.array(developerApiSchema).max(collections.apis),
    events: z.array(developerEventSchema).max(collections.events),
    dataModel: developerDataModelSchema,
    internalDependencies: z
      .array(developerInternalDependencySchema)
      .max(collections.internalDependencies),
    externalDependencies: z
      .array(developerExternalDependencySchema)
      .max(collections.externalDependencies),
    risks: z.array(developerRiskSchema).max(collections.risks),
    implementationPhases: z
      .array(developerImplementationPhaseSchema)
      .max(collections.implementationPhases),
    implementationPlan: z
      .array(developerImplementationPlanItemSchema)
      .max(collections.implementationPlan),
    technicalBacklog: z
      .array(developerTechnicalBacklogItemSchema)
      .max(collections.technicalBacklog),
    definitionOfDone: z
      .array(developerDefinitionOfDoneItemSchema)
      .max(collections.definitionOfDone),
    decisions: z.array(developerDecisionSchema).max(collections.decisions),
    traceability: z.array(developerTraceabilityItemSchema).max(collections.traceability),
    assumptions: z.array(developerAssumptionSchema).max(collections.assumptions),
    openQuestions: z.array(developerOpenQuestionSchema).max(collections.openQuestions),
    outOfScope: z.array(developerOutOfScopeItemSchema).max(collections.outOfScope),
  })
  .strict();

// Cross-document business rules require the Product Owner specification and are
// therefore evaluated by validateDeveloperBusinessRules at the facade boundary.
export const technicalSpecificationSchema = technicalSpecificationStructureSchema;

export const developerBusinessValidationIssueCodeSchema = z.enum(
  Object.values(DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES),
);

export const developerBusinessValidationIssueSchema = z
  .object({
    code: developerBusinessValidationIssueCodeSchema,
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])).max(32),
    message: boundedText(500),
  })
  .strict();

export const developerBusinessValidationResultSchema = z
  .object({
    valid: z.boolean(),
    expectedReadiness: developerReadinessSchema.nullable(),
    issues: z
      .array(developerBusinessValidationIssueSchema)
      .max(DEVELOPER_BUSINESS_VALIDATION_MAX_ISSUES),
    issuesTruncated: z.boolean(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.valid !== (result.issues.length === 0)) {
      addMismatch(context, ['valid'], 'valid deve corresponder à ausência de issues de negócio.');
    }
    if (result.valid && result.expectedReadiness === null) {
      addMismatch(
        context,
        ['expectedReadiness'],
        'Business Validation válida exige readiness derivada.',
      );
    }
    if (result.valid && result.issuesTruncated) {
      addMismatch(
        context,
        ['issuesTruncated'],
        'Uma Business Validation válida não pode possuir issues truncados.',
      );
    }
    if (
      result.issuesTruncated &&
      result.issues.length !== DEVELOPER_BUSINESS_VALIDATION_MAX_ISSUES
    ) {
      addMismatch(
        context,
        ['issuesTruncated'],
        'issuesTruncated exige que o limite público de issues tenha sido atingido.',
      );
    }
  });

export const developerAssetReferenceSchema = z
  .object({ id: identifierSchema, version: semanticVersionSchema, hash: hashSchema })
  .strict();

export const developerAssetsMetadataSchema = z
  .object({
    bundleHash: hashSchema,
    manifest: developerAssetReferenceSchema,
    template: developerAssetReferenceSchema,
    ruleSets: z.array(developerAssetReferenceSchema).length(3),
    outputContract: developerAssetReferenceSchema,
    validationContract: developerAssetReferenceSchema,
    artifactSpecification: developerAssetReferenceSchema,
  })
  .strict();

export const developerKnowledgeMetadataSchema = z
  .object({
    context: z.literal('DEVELOPER'),
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

export const developerRunMetadataSchema = z
  .object({
    prompt: promptMetadataSchema,
    provider: providerMetadataSchema,
    metrics: agentRunMetricsSchema,
    responseHash: agentRunOutputSchema.shape.responseHash,
    finishReason: agentRunOutputSchema.shape.finishReason,
  })
  .strict()
  .superRefine((run, context) => {
    if (run.prompt.metadata.agent !== 'DEVELOPER') {
      addMismatch(
        context,
        ['prompt', 'metadata', 'agent'],
        'O prompt deve pertencer ao Developer Agent.',
      );
    }
  });

export const developerResponseValidationSummarySchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(validationIssueSchema),
    metadata: validationMetadataSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const hasError = result.issues.some((issue) => issue.severity === 'ERROR');
    if (result.valid === hasError) {
      addMismatch(context, ['valid'], 'O resumo deve preservar a coerência do Response Validator.');
    }
  });

const resultMetadataBase = {
  assets: developerAssetsMetadataSchema,
  knowledge: developerKnowledgeMetadataSchema,
  run: developerRunMetadataSchema,
  sourceSpecificationHash: knowledgeHashSchema,
  sourcePromptContextHash: knowledgeHashSchema,
  sourceReadiness: productOwnerReadinessSchema,
};

const DEVELOPER_ARTIFACT_IDENTITIES = [
  {
    filename: 'architecture.md',
    name: 'Developer Architecture',
    type: 'DEVELOPER_ARCHITECTURE',
    templateId: 'artifact:developer-architecture',
    format: 'TEXT',
    mediaType: 'text/markdown',
  },
  {
    filename: 'implementation-plan.md',
    name: 'Developer Implementation Plan',
    type: 'DEVELOPER_IMPLEMENTATION_PLAN',
    templateId: 'artifact:developer-implementation-plan',
    format: 'TEXT',
    mediaType: 'text/markdown',
  },
  {
    filename: 'technical-decisions.json',
    name: 'Developer Technical Decisions',
    type: 'DEVELOPER_TECHNICAL_DECISIONS',
    templateId: 'artifact:developer-technical-decisions',
    format: 'JSON',
    mediaType: 'application/json',
  },
] as const;

const generatedResultSchema = z
  .object({
    outcome: z.literal('GENERATED'),
    context: developerAgentContextSchema,
    readiness: developerReadinessSchema,
    specification: technicalSpecificationSchema,
    artifacts: z.array(generatedArtifactSchema).length(3),
    validation: z
      .object({
        response: developerResponseValidationSummarySchema.safeExtend({ valid: z.literal(true) }),
        business: developerBusinessValidationResultSchema.safeExtend({ valid: z.literal(true) }),
      })
      .strict(),
    metadata: z
      .object({ ...resultMetadataBase, generation: artifactGenerationMetadataSchema })
      .strict(),
  })
  .strict()
  .superRefine((result, context) => {
    result.artifacts.forEach((artifact, index) => {
      const expected = DEVELOPER_ARTIFACT_IDENTITIES[index];
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
            'O artifact deve preservar a identidade e a ordem canônicas do Developer.',
          );
        }
      }
    });

    if (result.readiness !== result.specification.readiness) {
      addMismatch(context, ['readiness'], 'readiness deve corresponder à especificação.');
    }
    if (result.validation.business.expectedReadiness !== result.readiness) {
      addMismatch(
        context,
        ['validation', 'business', 'expectedReadiness'],
        'A readiness observada deve corresponder à Business Validation.',
      );
    }
    const expectedReadiness = deriveDeveloperReadiness(
      result.metadata.sourceReadiness,
      result.specification.openQuestions,
      result.specification.assumptions,
    );
    if (expectedReadiness !== result.readiness) {
      addMismatch(
        context,
        ['metadata', 'sourceReadiness'],
        'A readiness técnica deve preservar a prontidão funcional de origem.',
      );
    }
    if (result.metadata.generation.artifactCount !== result.artifacts.length) {
      addMismatch(
        context,
        ['metadata', 'generation', 'artifactCount'],
        'artifactCount deve corresponder aos artifacts retornados.',
      );
    }
    const totalBytes = result.artifacts.reduce(
      (total, artifact) => total + artifact.metadata.byteLength,
      0,
    );
    if (result.metadata.generation.totalBytes !== totalBytes) {
      addMismatch(
        context,
        ['metadata', 'generation', 'totalBytes'],
        'totalBytes deve corresponder à soma dos artifacts retornados.',
      );
    }
  });

const validationRejectedResultSchema = z
  .object({
    outcome: z.literal('VALIDATION_REJECTED'),
    rejectedAt: z.enum(['RESPONSE_VALIDATION', 'BUSINESS_VALIDATION']),
    context: developerAgentContextSchema,
    readiness: z.null(),
    specification: z.null(),
    artifacts: z.array(generatedArtifactSchema).max(0),
    validation: z
      .object({
        response: developerResponseValidationSummarySchema,
        business: developerBusinessValidationResultSchema.nullable(),
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
    if (!responseRejected && !businessRejected) {
      addMismatch(
        context,
        ['validation'],
        'O resultado rejeitado deve identificar a etapa funcional que o rejeitou.',
      );
    }
  });

export const developerAgentResultSchema = z
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
      const promptIndex = run.prompt.metadata.ruleSetHashes.findIndex(
        (ruleSet) => ruleSet.ruleSetId === asset.id,
      );
      const promptRuleSet = run.prompt.metadata.ruleSetHashes[promptIndex];
      if (promptRuleSet === undefined) {
        addMismatch(
          context,
          ['metadata', 'run', 'prompt', 'metadata', 'ruleSetHashes', assetIndex],
          'A proveniência do prompt deve conter cada rule set do bundle.',
        );
        return;
      }
      for (const [field, actual, expected] of [
        ['ruleSetId', promptRuleSet.ruleSetId, asset.id],
        ['version', promptRuleSet.version, asset.version],
        ['hash', promptRuleSet.hash, asset.hash],
      ] as const) {
        if (actual !== expected) {
          addMismatch(
            context,
            ['metadata', 'run', 'prompt', 'metadata', 'ruleSetHashes', promptIndex, field],
            'A proveniência do rule set deve corresponder ao bundle validado.',
          );
        }
      }
    });

    const promptContexts = run.prompt.metadata.contextHashes;
    const knowledgeContext = promptContexts.find(
      (promptContext) => promptContext.contextId === 'context:developer-knowledge',
    );
    const sourceSpecificationContext = promptContexts.find(
      (promptContext) => promptContext.contextId === 'context:product-owner-specification',
    );
    if (
      promptContexts.length !== 2 ||
      knowledgeContext?.kind !== 'KNOWLEDGE' ||
      sourceSpecificationContext?.kind !== 'ARTIFACT'
    ) {
      addMismatch(
        context,
        ['metadata', 'run', 'prompt', 'metadata', 'contextHashes'],
        'A proveniência deve conter exatamente knowledge e a especificação do Product Owner.',
      );
    }
    if (
      knowledgeContext !== undefined &&
      (knowledgeContext.serialization !== 'TEXT' ||
        knowledgeContext.contentHash !== result.metadata.knowledge.contextHash)
    ) {
      addMismatch(
        context,
        ['metadata', 'run', 'prompt', 'metadata', 'contextHashes'],
        'O contexto de knowledge deve corresponder ao contexto carregado.',
      );
    }
    if (
      sourceSpecificationContext !== undefined &&
      (sourceSpecificationContext.serialization !== 'JSON' ||
        sourceSpecificationContext.references.length !== 0 ||
        sourceSpecificationContext.contentHash !== result.metadata.sourcePromptContextHash)
    ) {
      addMismatch(
        context,
        ['metadata', 'run', 'prompt', 'metadata', 'contextHashes'],
        'O contexto funcional deve preservar o hash da especificação do Product Owner.',
      );
    }
    if (knowledgeContext !== undefined) {
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
