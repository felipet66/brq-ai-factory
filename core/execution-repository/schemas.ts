import { executionObservabilitySnapshotSchema } from '@brq/observability';
import {
  factoryPipelineProfileRuleIdSchema,
  factoryTypeScriptDiagnosticSummarySchema,
} from '@brq/factory-pipeline';
import { jobIdSchema, jobStatusSchema } from '@brq/job-queue';
import { isoDateTimeSchema, semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import {
  readinessDecisionFactorMatchesStage,
  readinessDecisionMatchesStageState,
  readinessDecisionSchema,
  readinessDecisionSourceMatchesStages,
  readinessEvidenceStagesAreCanonical,
} from '@brq/shared/schemas/readiness-decision.schema';
import { z } from 'zod';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const KNOWLEDGE_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

export const executionRecordStatusSchema = z.enum([
  'CREATED',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
]);
export const terminalExecutionRecordStatusSchema = z.enum(['SUCCESS', 'FAILED', 'CANCELLED']);

const nullableHashSchema = z.string().regex(HASH_PATTERN).nullable();
const nullableKnowledgeHashSchema = z.string().regex(KNOWLEDGE_HASH_PATTERN).nullable();

export const executionRecordHashesSchema = z
  .object({
    executionRequestHash: nullableHashSchema,
    workflowRequestHash: nullableHashSchema,
    workflowHash: nullableHashSchema,
    lineageHash: nullableHashSchema,
    provenanceHash: nullableHashSchema,
    executionHash: nullableHashSchema,
  })
  .strict();

export const executionRecordMetadataSchema = z
  .object({
    engineVersion: semanticVersionSchema,
    contractVersion: semanticVersionSchema,
    attempt: z.literal(1),
  })
  .strict();

export const executionRecordJobSchema = z
  .object({
    jobId: jobIdSchema,
    status: jobStatusSchema,
    queuedAt: isoDateTimeSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((job, context) => {
    if (job.startedAt !== null && Date.parse(job.startedAt) < Date.parse(job.queuedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['startedAt'],
        message: 'O início do job não pode anteceder seu enfileiramento.',
      });
    }
    if (
      job.finishedAt !== null &&
      Date.parse(job.finishedAt) < Date.parse(job.startedAt ?? job.queuedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'O término do job não pode anteceder seu início.',
      });
    }
    if (job.status === 'QUEUED' && (job.startedAt !== null || job.finishedAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Um job QUEUED não pode possuir início ou término.',
      });
    }
    if (job.status === 'RUNNING' && (job.startedAt === null || job.finishedAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Um job RUNNING exige início e não pode possuir término.',
      });
    }
    if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(job.status) && job.finishedAt === null) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'Um job terminal exige finishedAt.',
      });
    }
  });

export const persistedLineageHandoffSchema = z
  .object({
    from: z.enum(['PRODUCT_OWNER', 'DEVELOPER']),
    to: z.enum(['DEVELOPER', 'QA']),
    specification: z.enum(['PRODUCT_OWNER_SPECIFICATION', 'TECHNICAL_SPECIFICATION']),
    calculatedHash: z.string().regex(KNOWLEDGE_HASH_PATTERN),
    declaredHash: z.string().regex(KNOWLEDGE_HASH_PATTERN),
    verified: z.literal(true),
  })
  .strict();

export const persistedLineageSchema = z
  .object({
    outputs: z
      .object({
        productOwnerSpecificationHash: nullableKnowledgeHashSchema,
        technicalSpecificationHash: nullableKnowledgeHashSchema,
        qaSpecificationHash: nullableKnowledgeHashSchema,
      })
      .strict(),
    handoffs: z.array(persistedLineageHandoffSchema).max(3),
  })
  .strict();

export const persistedProvenanceStageSchema = z
  .object({
    stage: z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']),
    agent: z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']),
    executionId: z.string().min(1).max(128),
    agentExecutionId: z.string().min(1).max(128),
    agentVersion: z.string().min(1).max(128),
    outcome: z.enum(['GENERATED', 'VALIDATION_REJECTED']),
    readiness: z.string().min(1).max(64).nullable(),
    readinessDecision: readinessDecisionSchema.nullable().default(null),
    assetBundleHash: z.string().regex(HASH_PATTERN),
    knowledgeContextHash: z.string().regex(KNOWLEDGE_HASH_PATTERN),
    promptHash: z.string().regex(HASH_PATTERN),
    responseHash: z.string().regex(HASH_PATTERN),
    validationHash: z.string().regex(HASH_PATTERN),
    generationHash: nullableHashSchema,
    artifactHashes: z.array(z.string().regex(HASH_PATTERN)).max(100),
  })
  .strict()
  .superRefine((stage, context) => {
    if (!readinessDecisionMatchesStageState(stage)) {
      context.addIssue({
        code: 'custom',
        path: ['readinessDecision'],
        message: 'Persisted readiness evidence must match the stage outcome and readiness.',
      });
    }
    stage.readinessDecision?.decisiveFactors.forEach((factor, index) => {
      if (!readinessDecisionFactorMatchesStage(stage.stage, factor)) {
        context.addIssue({
          code: 'custom',
          path: ['readinessDecision', 'decisiveFactors', index],
          message: 'Persisted readiness evidence must identify a real source stage.',
        });
      }
    });
  });

export const persistedProvenanceSchema = z
  .object({ stages: z.array(persistedProvenanceStageSchema).max(3) })
  .strict()
  .superRefine((provenance, context) => {
    if (!readinessEvidenceStagesAreCanonical(provenance.stages)) {
      context.addIssue({
        code: 'custom',
        path: ['stages'],
        message: 'Persisted provenance stages must be a unique canonical workflow prefix.',
      });
    }
    provenance.stages.forEach((stage, stageIndex) => {
      stage.readinessDecision?.decisiveFactors.forEach((factor, factorIndex) => {
        if (!readinessDecisionSourceMatchesStages(factor, provenance.stages)) {
          context.addIssue({
            code: 'custom',
            path: ['stages', stageIndex, 'readinessDecision', 'decisiveFactors', factorIndex],
            message: 'Persisted SOURCE evidence must match the recorded upstream stage.',
          });
        }
      });
    });
  });

export const persistedFactoryStageIdSchema = z.enum([
  'PRODUCT_OWNER',
  'DEVELOPER',
  'QA',
  'CODE_GENERATOR',
  'CODE_PROFILE_VALIDATION',
  'WORKSPACE_PLAN',
  'WORKSPACE_MATERIALIZATION',
  'SANDBOX_PREPARE',
  'SANDBOX_TYPECHECK',
  'SANDBOX_BUILD',
  'SANDBOX_TEST',
  'WORKSPACE_RELEASE',
]);

export const persistedFactoryStageSchema = z
  .object({
    stageId: persistedFactoryStageIdSchema,
    status: z.enum(['SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED']),
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    outputHash: nullableHashSchema,
    failureCode: z.string().min(1).max(128).nullable(),
    reasonCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,63}$/)
      .nullable(),
    profileRuleId: factoryPipelineProfileRuleIdSchema.nullable().default(null),
    diagnosticSummary: factoryTypeScriptDiagnosticSummarySchema.nullable().default(null),
    resourceOutcome: z
      .enum(['NONE', 'OOM', 'PID_LIMIT', 'DISK_LIMIT', 'OUTPUT_LIMIT', 'UNKNOWN'])
      .nullable(),
  })
  .strict()
  .superRefine((stage, context) => {
    if (stage.profileRuleId !== null && stage.stageId !== 'CODE_PROFILE_VALIDATION') {
      context.addIssue({
        code: 'custom',
        path: ['profileRuleId'],
        message: 'Somente CODE_PROFILE_VALIDATION pode persistir uma regra do profile.',
      });
    }
    if (stage.profileRuleId !== null && stage.status !== 'FAILED') {
      context.addIssue({
        code: 'custom',
        path: ['profileRuleId'],
        message: 'Uma regra do profile só pode acompanhar uma rejeição do profile.',
      });
    }
    if (
      stage.diagnosticSummary !== null &&
      (stage.stageId !== 'SANDBOX_TYPECHECK' ||
        stage.status !== 'FAILED' ||
        stage.reasonCode !== 'TYPESCRIPT_DIAGNOSTICS')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['diagnosticSummary'],
        message: 'Diagnósticos TypeScript pertencem somente a uma falha de typecheck.',
      });
    }
  });

export const persistedFactoryLineageSchema = z
  .object({
    productOwnerSpecificationHash: nullableKnowledgeHashSchema,
    technicalSpecificationHash: nullableKnowledgeHashSchema,
    qaSpecificationHash: nullableKnowledgeHashSchema,
    executionHash: z.string().regex(HASH_PATTERN),
    workflowHash: nullableHashSchema,
    generationHash: nullableHashSchema,
    bundleHash: nullableHashSchema,
    bundleContentHash: nullableHashSchema,
    workspacePlanHash: nullableHashSchema,
    workspaceHash: nullableHashSchema,
    sandboxRequestHash: nullableHashSchema,
    sandboxResultHash: nullableHashSchema,
    executionProfileHash: nullableHashSchema,
    generationProjectionHash: nullableHashSchema,
    profileValidationHash: nullableHashSchema,
    factoryResultHash: z.string().regex(HASH_PATTERN),
  })
  .strict();

export const persistedFactoryProvenanceSchema = z
  .object({
    codeGeneratorAgentVersion: semanticVersionSchema,
    codeGeneratorContractVersion: semanticVersionSchema.nullable(),
    codeGeneratorAssetBundleHash: nullableHashSchema,
    executionProfileId: z.string().min(1).max(64).nullable(),
    executionProfileVersion: semanticVersionSchema.nullable(),
    executionProfileContractVersion: semanticVersionSchema.nullable(),
    executionProfileHash: nullableHashSchema,
    generationProjectionHash: nullableHashSchema,
    profileValidationHash: nullableHashSchema,
    workspaceVersion: semanticVersionSchema.nullable(),
    workspaceContractVersion: semanticVersionSchema.nullable(),
    workspacePolicyHash: nullableHashSchema,
    workspaceConfigurationHash: nullableHashSchema,
    sandboxRunnerVersion: semanticVersionSchema.nullable(),
    sandboxContractVersion: semanticVersionSchema.nullable(),
    sandboxSanitizerVersion: semanticVersionSchema.nullable(),
    sandboxHelperAbiVersion: semanticVersionSchema.nullable(),
    sandboxDependencySnapshotHash: nullableHashSchema,
    sandboxPolicyId: z.string().min(1).max(64).nullable(),
    sandboxPolicyVersion: semanticVersionSchema.nullable(),
    sandboxPolicyHash: nullableHashSchema,
    sandboxCommandPolicyHash: nullableHashSchema,
    sandboxLimitsHash: nullableHashSchema,
    sandboxAdapter: z.string().min(1).max(64).nullable(),
    sandboxImageDigest: nullableKnowledgeHashSchema,
    sandboxImageId: z.string().min(1).max(256).nullable(),
    sandboxPlatform: z.string().min(1).max(128).nullable(),
    sandboxRuntimeName: z.string().min(1).max(128).nullable(),
    sandboxRuntimeVersion: z.string().min(1).max(128).nullable(),
    toolchainVersions: z.record(z.string().min(1).max(128), z.string().min(1).max(128)).readonly(),
  })
  .strict();

export const persistedFactoryResultSchema = z
  .object({
    factoryVersion: semanticVersionSchema,
    contractVersion: semanticVersionSchema,
    status: terminalExecutionRecordStatusSchema,
    terminalStage: z.union([
      persistedFactoryStageIdSchema,
      z.literal('EXECUTION'),
      z.literal('SANDBOX'),
    ]),
    startedAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema,
    durationMs: z.number().int().nonnegative(),
    readiness: z.string().min(1).max(64).nullable(),
    generationStatus: z.enum(['SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED']),
    generatedFileCount: z.number().int().positive().nullable(),
    generatedTotalBytes: z.number().int().positive().nullable(),
    workspaceId: z
      .string()
      .regex(/^workspace-[a-f0-9]{32}$/)
      .nullable(),
    workspaceFileCount: z.number().int().positive().nullable(),
    workspaceTotalBytes: z.number().int().nonnegative().nullable(),
    workspaceReleaseStatus: z.enum(['RELEASED', 'FAILED', 'NOT_REQUIRED']),
    sandboxStatus: z.enum(['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'SKIPPED']),
    sandboxRunId: z
      .string()
      .regex(/^sandbox-[a-f0-9]{32}$/)
      .nullable(),
    sandboxResourceOutcome: z.enum([
      'NONE',
      'OOM',
      'PID_LIMIT',
      'DISK_LIMIT',
      'OUTPUT_LIMIT',
      'UNKNOWN',
    ]),
    hashes: z
      .object({
        lineageHash: z.string().regex(HASH_PATTERN),
        provenanceHash: z.string().regex(HASH_PATTERN),
        factoryResultHash: z.string().regex(HASH_PATTERN),
      })
      .strict(),
    failure: z
      .object({
        kind: z.literal('FACTORY_PIPELINE'),
        code: z.string().min(1).max(128),
        sourceCode: z.string().min(1).max(128).nullable(),
        reasonCode: z
          .string()
          .regex(/^[A-Z][A-Z0-9_]{1,63}$/)
          .nullable(),
        profileRuleId: factoryPipelineProfileRuleIdSchema.nullable().default(null),
        diagnosticSummary: factoryTypeScriptDiagnosticSummarySchema.nullable().default(null),
        stageId: z.union([
          persistedFactoryStageIdSchema,
          z.literal('EXECUTION'),
          z.literal('SANDBOX'),
        ]),
      })
      .strict()
      .superRefine((failure, context) => {
        if (failure.profileRuleId !== null && failure.stageId !== 'CODE_PROFILE_VALIDATION') {
          context.addIssue({
            code: 'custom',
            path: ['profileRuleId'],
            message: 'Somente CODE_PROFILE_VALIDATION pode persistir uma regra do profile.',
          });
        }
        if (
          failure.diagnosticSummary !== null &&
          (failure.stageId !== 'SANDBOX_TYPECHECK' ||
            failure.reasonCode !== 'TYPESCRIPT_DIAGNOSTICS')
        ) {
          context.addIssue({
            code: 'custom',
            path: ['diagnosticSummary'],
            message: 'Diagnósticos TypeScript pertencem somente a uma falha de typecheck.',
          });
        }
      })
      .nullable(),
    stages: z.array(persistedFactoryStageSchema).length(12),
    lineage: persistedFactoryLineageSchema,
    provenance: persistedFactoryProvenanceSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (Date.parse(result.finishedAt) < Date.parse(result.startedAt)) {
      context.addIssue({ code: 'custom', path: ['finishedAt'], message: 'Término inválido.' });
    }
    result.stages.forEach((stage, index) => {
      if (stage.stageId !== persistedFactoryStageIdSchema.options[index]) {
        context.addIssue({
          code: 'custom',
          path: ['stages', index, 'stageId'],
          message: 'As etapas persistidas devem preservar a ordem canônica.',
        });
      }
    });
    if (result.hashes.factoryResultHash !== result.lineage.factoryResultHash) {
      context.addIssue({
        code: 'custom',
        path: ['lineage', 'factoryResultHash'],
        message: 'O lineage deve preservar o hash terminal da Factory.',
      });
    }
    if ((result.status === 'SUCCESS') !== (result.failure === null)) {
      context.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'Somente resultados não bem-sucedidos possuem falha terminal.',
      });
    }
    const terminalStage = result.stages.find((stage) => stage.stageId === result.terminalStage);
    if (
      result.failure !== null &&
      result.failure.profileRuleId !== (terminalStage?.profileRuleId ?? null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failure', 'profileRuleId'],
        message: 'A regra persistida deve coincidir entre a falha terminal e sua etapa.',
      });
    }
    if (
      result.failure !== null &&
      JSON.stringify(result.failure.diagnosticSummary) !==
        JSON.stringify(terminalStage?.diagnosticSummary ?? null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failure', 'diagnosticSummary'],
        message: 'O diagnóstico persistido deve coincidir entre a falha e sua etapa.',
      });
    }
  });

export const executionRecordFailureSchema = z
  .object({
    kind: z.string().min(1).max(64),
    code: z.string().min(1).max(128),
    sourceCode: z.string().min(1).max(128).nullable(),
  })
  .strict();

export const executionRecordLifecycleEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    event: z.enum([
      'EXECUTION_CREATED',
      'EXECUTION_RUNNING',
      'EXECUTION_FINISHED',
      'EXECUTION_FAILED',
      'EXECUTION_CANCELLED',
    ]),
    state: executionRecordStatusSchema,
    occurredAt: isoDateTimeSchema,
    durationMs: z.number().int().nonnegative().nullable(),
  })
  .strict();

const executionRecordBaseShape = {
  storageId: z.string().min(1).max(128),
  workflowId: z.string().min(1).max(128),
  executionId: z
    .string()
    .regex(/^execution-[a-f0-9]{32}$/)
    .nullable(),
  requestId: z.string().min(1).max(128).nullable(),
  traceId: z.string().min(1).max(128).nullable(),
  projectName: z.string().min(1).max(500),
  status: executionRecordStatusSchema,
  workflowStatus: terminalExecutionRecordStatusSchema.nullable(),
  readiness: z.string().min(1).max(64).nullable(),
  createdAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  job: executionRecordJobSchema.nullable(),
  metadata: executionRecordMetadataSchema,
  hashes: executionRecordHashesSchema,
  failure: executionRecordFailureSchema.nullable(),
  lineage: persistedLineageSchema.nullable(),
  provenance: persistedProvenanceSchema.nullable(),
  factoryResult: persistedFactoryResultSchema.nullable(),
  observation: executionObservabilitySnapshotSchema.nullable(),
  lifecycle: z.array(executionRecordLifecycleEventSchema).min(1).max(3),
  revision: z.number().int().nonnegative(),
};

export const executionRecordSchema = z
  .object(executionRecordBaseShape)
  .strict()
  .superRefine((record, context) => {
    record.lifecycle.forEach((event, index) => {
      if (event.sequence !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['lifecycle', index, 'sequence'],
          message: 'A sequência do lifecycle deve ser contígua.',
        });
      }
    });
    const terminal = terminalExecutionRecordStatusSchema.safeParse(record.status).success;
    if (terminal && (record.executionId === null || record.finishedAt === null)) {
      context.addIssue({
        code: 'custom',
        path: ['executionId'],
        message: 'Um registro terminal exige executionId e finishedAt.',
      });
    }
    if (!terminal && (record.finishedAt !== null || record.workflowStatus !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Um registro ativo não pode conter metadados terminais.',
      });
    }
    if (record.observation !== null) {
      if (
        record.executionId !== record.observation.executionId ||
        record.workflowId !== record.observation.workflowId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['observation'],
          message: 'A observação deve pertencer ao registro.',
        });
      }
    }
    if (record.job !== null && record.executionId === null) {
      context.addIssue({
        code: 'custom',
        path: ['job'],
        message: 'Um registro enfileirado exige executionId reservado.',
      });
    }
    if (terminal && record.job !== null && record.job.status !== record.status) {
      context.addIssue({
        code: 'custom',
        path: ['job', 'status'],
        message: 'O status terminal do job deve acompanhar a execução.',
      });
    }
  });

export const executionRecordCreatedInputSchema = z
  .object({
    workflowId: executionRecordSchema.shape.workflowId,
    requestId: executionRecordSchema.shape.requestId,
    traceId: executionRecordSchema.shape.traceId,
    projectName: executionRecordSchema.shape.projectName,
    createdAt: isoDateTimeSchema,
    metadata: executionRecordMetadataSchema,
  })
  .strict();

export const executionRecordRunningInputSchema = z
  .object({
    workflowId: executionRecordSchema.shape.workflowId,
    startedAt: isoDateTimeSchema,
  })
  .strict();

export const executionRecordQueuedInputSchema = executionRecordCreatedInputSchema
  .extend({
    executionId: executionRecordSchema.shape.executionId.unwrap(),
    jobId: jobIdSchema,
    queuedAt: isoDateTimeSchema,
  })
  .omit({ createdAt: true })
  .strict();

export const executionRecordJobRunningInputSchema = z
  .object({
    jobId: jobIdSchema,
    startedAt: isoDateTimeSchema,
  })
  .strict();

export const executionRecordJobTerminalInputSchema = z
  .object({
    jobId: jobIdSchema,
    status: terminalExecutionRecordStatusSchema,
    finishedAt: isoDateTimeSchema,
  })
  .strict();

export const executionRecordObservationInputSchema = z
  .object({
    workflowId: executionRecordSchema.shape.workflowId,
    snapshot: executionObservabilitySnapshotSchema,
  })
  .strict();

export const executionRecordListQuerySchema = z
  .object({
    status: executionRecordStatusSchema.optional(),
    readiness: z.string().min(1).max(64).optional(),
    createdAfter: isoDateTimeSchema.optional(),
    createdBefore: isoDateTimeSchema.optional(),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).max(128).optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (
      query.createdAfter !== undefined &&
      query.createdBefore !== undefined &&
      Date.parse(query.createdAfter) > Date.parse(query.createdBefore)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['createdAfter'],
        message: 'createdAfter não pode ser posterior a createdBefore.',
      });
    }
  });

export const executionRecordPageSchema = z
  .object({
    items: z.array(executionRecordSchema).max(100),
    nextCursor: z.string().min(1).max(128).nullable(),
  })
  .strict();
