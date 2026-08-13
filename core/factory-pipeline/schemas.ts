import { codeGeneratorAgentLimitsSchema } from '@brq/code-generator-agent';
import {
  FACTORY_EXECUTION_PROFILE_RULE_IDS,
  factoryExecutionProfileSchema,
} from '@brq/factory-execution-profile';
import { sandboxDiagnosticSummarySchema, sandboxLimitReductionsSchema } from '@brq/sandbox-runner';
import {
  identifierSchema,
  isoDateTimeSchema,
  semanticVersionSchema,
} from '@brq/shared/schemas/common.schema';
import {
  readinessDecisionFactorMatchesStage,
  readinessDecisionMatchesStageState,
  readinessDecisionSchema,
  readinessDecisionSourceMatchesStages,
  readinessEvidenceStagesAreCanonical,
} from '@brq/shared/schemas/readiness-decision.schema';
import { z } from 'zod';

import {
  calculateFactoryPipelineLineageHash,
  calculateFactoryPipelineProvenanceHash,
  calculateFactoryPipelineResultHash,
} from './hashing';
import { FACTORY_PIPELINE_STAGE_IDS } from './state-machine';
import {
  FACTORY_PIPELINE_CONTRACT_VERSION,
  FACTORY_PIPELINE_HASH_ALGORITHM,
  FACTORY_PIPELINE_VERSION,
} from './version';

const HASH = /^[a-f0-9]{64}$/u;
const PREFIXED_HASH = /^sha256:[a-f0-9]{64}$/u;

export const factoryPipelineHashSchema = z.string().regex(HASH);
export const factoryPipelinePrefixedHashSchema = z.string().regex(PREFIXED_HASH);
export const factoryPipelineProfileRuleIdSchema = z.enum(FACTORY_EXECUTION_PROFILE_RULE_IDS);
// Factory intentionally reuses the authoritative Sandbox contract instead of
// maintaining a parallel set of limits or normalization rules.
export const factoryTypeScriptDiagnosticSummarySchema = sandboxDiagnosticSummarySchema;

export const factoryPipelineStatusSchema = z.enum(['SUCCESS', 'FAILED', 'CANCELLED']);
export const factoryPipelineStageIdSchema = z.enum(FACTORY_PIPELINE_STAGE_IDS);
export const factoryPipelineStageStatusSchema = z.enum([
  'SUCCESS',
  'FAILED',
  'CANCELLED',
  'SKIPPED',
]);

export const factoryPipelineConfigurationSchema = z
  .object({
    executionProfile: factoryExecutionProfileSchema,
    codeGenerator: z
      .object({
        agentVersion: semanticVersionSchema,
        model: z.string().trim().min(1).max(200),
        limits: codeGeneratorAgentLimitsSchema.optional(),
      })
      .strict(),
    sandbox: z
      .object({
        policyId: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
        policyVersion: semanticVersionSchema,
        profileSnapshotHash: factoryPipelineHashSchema,
        limits: sandboxLimitReductionsSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((configuration, context) => {
    if (configuration.executionProfile.sandbox.policyId !== configuration.sandbox.policyId) {
      context.addIssue({
        code: 'custom',
        path: ['executionProfile', 'sandbox', 'policyId'],
        message: 'O Factory Execution Profile deve corresponder à policy de Sandbox selecionada.',
      });
    }
    if (
      configuration.executionProfile.sandbox.policyVersion !== configuration.sandbox.policyVersion
    ) {
      context.addIssue({
        code: 'custom',
        path: ['executionProfile', 'sandbox', 'policyVersion'],
        message: 'A versão da policy deve corresponder ao Factory Execution Profile.',
      });
    }
  });

export const factoryPipelineFailureSchema = z
  .object({
    code: z.string().trim().min(1).max(128),
    stage: z.union([factoryPipelineStageIdSchema, z.literal('EXECUTION'), z.literal('SANDBOX')]),
    sourceCode: z.string().trim().min(1).max(128).nullable(),
    reasonCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,63}$/u)
      .nullable(),
    profileRuleId: factoryPipelineProfileRuleIdSchema.nullable(),
    diagnosticSummary: factoryTypeScriptDiagnosticSummarySchema.nullable(),
    message: z.string().trim().min(1).max(300),
  })
  .strict()
  .superRefine((failure, context) => {
    if (failure.profileRuleId !== null && failure.stage !== 'CODE_PROFILE_VALIDATION') {
      context.addIssue({
        code: 'custom',
        path: ['profileRuleId'],
        message: 'Somente CODE_PROFILE_VALIDATION pode identificar uma regra do profile.',
      });
    }
    if (
      failure.diagnosticSummary !== null &&
      (failure.stage !== 'SANDBOX_TYPECHECK' || failure.reasonCode !== 'TYPESCRIPT_DIAGNOSTICS')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['diagnosticSummary'],
        message: 'Diagnósticos TypeScript pertencem somente ao typecheck correspondente.',
      });
    }
  });

export const factoryPipelineStageResultSchema = z
  .object({
    stageId: factoryPipelineStageIdSchema,
    status: factoryPipelineStageStatusSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    outputHash: factoryPipelineHashSchema.nullable(),
    profileRuleId: factoryPipelineProfileRuleIdSchema.nullable(),
    diagnosticSummary: factoryTypeScriptDiagnosticSummarySchema.nullable(),
    failure: factoryPipelineFailureSchema.nullable(),
  })
  .strict()
  .superRefine((stage, context) => {
    if (stage.status === 'SKIPPED') {
      if (
        stage.startedAt !== null ||
        stage.finishedAt !== null ||
        stage.durationMs !== null ||
        stage.outputHash !== null ||
        stage.profileRuleId !== null ||
        stage.diagnosticSummary !== null ||
        stage.failure !== null
      ) {
        context.addIssue({ code: 'custom', message: 'Uma etapa SKIPPED não possui observações.' });
      }
      return;
    }
    if (stage.startedAt === null || stage.finishedAt === null || stage.durationMs === null) {
      context.addIssue({
        code: 'custom',
        message: 'Uma etapa executada exige observações temporais.',
      });
      return;
    }
    if (Date.parse(stage.finishedAt) < Date.parse(stage.startedAt)) {
      context.addIssue({ code: 'custom', path: ['finishedAt'], message: 'Término inválido.' });
    }
    if (stage.status === 'SUCCESS' && stage.failure !== null) {
      context.addIssue({ code: 'custom', path: ['failure'], message: 'SUCCESS não possui falha.' });
    }
    if ((stage.status === 'FAILED' || stage.status === 'CANCELLED') && stage.failure === null) {
      context.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'Falha terminal obrigatória.',
      });
    }
    if (stage.failure !== null && stage.failure.stage !== stage.stageId) {
      context.addIssue({
        code: 'custom',
        path: ['failure', 'stage'],
        message: 'A falha deve identificar a própria etapa.',
      });
    }
    if (stage.profileRuleId !== (stage.failure?.profileRuleId ?? null)) {
      context.addIssue({
        code: 'custom',
        path: ['profileRuleId'],
        message: 'A etapa deve preservar exatamente a regra estrutural da falha.',
      });
    }
    if (
      JSON.stringify(stage.diagnosticSummary) !==
      JSON.stringify(stage.failure?.diagnosticSummary ?? null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['diagnosticSummary'],
        message: 'A etapa deve preservar exatamente o diagnóstico seguro da falha.',
      });
    }
    if (
      stage.diagnosticSummary !== null &&
      (stage.stageId !== 'SANDBOX_TYPECHECK' ||
        stage.status !== 'FAILED' ||
        stage.failure?.reasonCode !== 'TYPESCRIPT_DIAGNOSTICS')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['diagnosticSummary'],
        message: 'Diagnósticos TypeScript pertencem somente a uma falha de typecheck.',
      });
    }
    if (stage.profileRuleId !== null && stage.stageId !== 'CODE_PROFILE_VALIDATION') {
      context.addIssue({
        code: 'custom',
        path: ['profileRuleId'],
        message: 'Somente CODE_PROFILE_VALIDATION pode identificar uma regra do profile.',
      });
    }
  });

const agentExecutionSummarySchema = z
  .object({
    status: factoryPipelineStageStatusSchema,
    outcome: z.enum(['GENERATED', 'VALIDATION_REJECTED']).nullable(),
    readiness: z.string().trim().min(1).max(64).nullable(),
    agentVersion: semanticVersionSchema.nullable(),
    outputHash: factoryPipelineHashSchema.nullable(),
  })
  .strict();

export const factoryAgentsSummarySchema = z
  .object({
    productOwner: agentExecutionSummarySchema,
    developer: agentExecutionSummarySchema,
    qa: agentExecutionSummarySchema,
  })
  .strict();

export const factorySourceExecutionSummarySchema = z
  .object({
    status: z.enum(['SUCCESS', 'FAILED', 'CANCELLED']),
    readiness: z.string().trim().min(1).max(64).nullable(),
    hashes: z
      .object({
        executionRequestHash: factoryPipelineHashSchema,
        workflowRequestHash: factoryPipelineHashSchema,
        workflowHash: factoryPipelineHashSchema.nullable(),
        lineageHash: factoryPipelineHashSchema.nullable(),
        provenanceHash: factoryPipelineHashSchema.nullable(),
        executionHash: factoryPipelineHashSchema,
      })
      .strict(),
    lineage: z
      .object({
        outputs: z
          .object({
            productOwnerSpecificationHash: factoryPipelinePrefixedHashSchema.nullable(),
            technicalSpecificationHash: factoryPipelinePrefixedHashSchema.nullable(),
            qaSpecificationHash: factoryPipelinePrefixedHashSchema.nullable(),
          })
          .strict(),
        handoffs: z.array(
          z
            .object({
              from: z.enum(['PRODUCT_OWNER', 'DEVELOPER']),
              to: z.enum(['DEVELOPER', 'QA']),
              specification: z.enum(['PRODUCT_OWNER_SPECIFICATION', 'TECHNICAL_SPECIFICATION']),
              calculatedHash: factoryPipelinePrefixedHashSchema,
              declaredHash: factoryPipelinePrefixedHashSchema,
              verified: z.literal(true),
            })
            .strict(),
        ),
      })
      .strict()
      .nullable(),
    provenance: z
      .object({
        stages: z.array(
          z
            .object({
              stage: z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']),
              agent: z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']),
              executionId: identifierSchema,
              agentExecutionId: identifierSchema,
              agentVersion: semanticVersionSchema,
              outcome: z.enum(['GENERATED', 'VALIDATION_REJECTED']),
              readiness: z.string().trim().min(1).max(64).nullable(),
              readinessDecision: readinessDecisionSchema.nullable().default(null),
              assetBundleHash: factoryPipelineHashSchema,
              knowledgeContextHash: factoryPipelinePrefixedHashSchema,
              promptHash: factoryPipelineHashSchema,
              responseHash: factoryPipelineHashSchema,
              validationHash: factoryPipelineHashSchema,
              generationHash: factoryPipelineHashSchema.nullable(),
              artifactHashes: z.array(factoryPipelineHashSchema),
            })
            .strict()
            .superRefine((stage, context) => {
              if (!readinessDecisionMatchesStageState(stage)) {
                context.addIssue({
                  code: 'custom',
                  path: ['readinessDecision'],
                  message: 'Readiness evidence must match the source stage outcome and readiness.',
                });
              }
              stage.readinessDecision?.decisiveFactors.forEach((factor, index) => {
                if (!readinessDecisionFactorMatchesStage(stage.stage, factor)) {
                  context.addIssue({
                    code: 'custom',
                    path: ['readinessDecision', 'decisiveFactors', index],
                    message: 'Readiness evidence must identify a real source stage.',
                  });
                }
              });
            }),
        ),
      })
      .strict()
      .superRefine((provenance, context) => {
        if (!readinessEvidenceStagesAreCanonical(provenance.stages)) {
          context.addIssue({
            code: 'custom',
            path: ['stages'],
            message: 'Source provenance stages must be a unique canonical workflow prefix.',
          });
        }
        provenance.stages.forEach((stage, stageIndex) => {
          stage.readinessDecision?.decisiveFactors.forEach((factor, factorIndex) => {
            if (!readinessDecisionSourceMatchesStages(factor, provenance.stages)) {
              context.addIssue({
                code: 'custom',
                path: ['stages', stageIndex, 'readinessDecision', 'decisiveFactors', factorIndex],
                message: 'SOURCE evidence must match the recorded upstream stage.',
              });
            }
          });
        });
      })
      .nullable(),
  })
  .strict();

export const factoryGenerationSummarySchema = z
  .object({
    status: factoryPipelineStageStatusSchema,
    outcome: z.enum(['GENERATED', 'VALIDATION_REJECTED']).nullable(),
    agentVersion: semanticVersionSchema,
    bundleVersion: semanticVersionSchema.nullable(),
    contractVersion: semanticVersionSchema.nullable(),
    fileCount: z.number().int().positive().nullable(),
    totalBytes: z.number().int().positive().nullable(),
    hashes: z
      .object({
        bundleContentHash: factoryPipelineHashSchema,
        manifestHash: factoryPipelineHashSchema,
        lineageHash: factoryPipelineHashSchema,
        provenanceHash: factoryPipelineHashSchema,
        bundleHash: factoryPipelineHashSchema,
        generationHash: factoryPipelineHashSchema,
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((summary, context) => {
    const generated = summary.status === 'SUCCESS' && summary.outcome === 'GENERATED';
    const hasGeneration =
      summary.bundleVersion !== null &&
      summary.contractVersion !== null &&
      summary.fileCount !== null &&
      summary.totalBytes !== null &&
      summary.hashes !== null;
    if (generated !== hasGeneration) {
      context.addIssue({ code: 'custom', message: 'Metadados de geração inconsistentes.' });
    }
  });

export const factoryWorkspaceSummarySchema = z
  .object({
    planStatus: factoryPipelineStageStatusSchema,
    materializationStatus: factoryPipelineStageStatusSchema,
    releaseStatus: z.enum(['RELEASED', 'FAILED', 'NOT_REQUIRED']),
    workspaceId: z
      .string()
      .regex(/^workspace-[a-f0-9]{32}$/u)
      .nullable(),
    fileCount: z.number().int().positive().nullable(),
    totalBytes: z.number().int().nonnegative().nullable(),
    hashes: z
      .object({
        sourceBundleHash: factoryPipelineHashSchema,
        planHash: factoryPipelineHashSchema,
        workspaceHash: factoryPipelineHashSchema,
        policyHash: factoryPipelineHashSchema,
        configurationHash: factoryPipelineHashSchema,
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((summary, context) => {
    const materialized = summary.materializationStatus === 'SUCCESS';
    const hasMaterialization =
      summary.workspaceId !== null &&
      summary.fileCount !== null &&
      summary.totalBytes !== null &&
      summary.hashes !== null;
    if (materialized !== hasMaterialization) {
      context.addIssue({ code: 'custom', message: 'Metadados de materialização inconsistentes.' });
    }
    if (summary.materializationStatus === 'SKIPPED' && summary.releaseStatus !== 'NOT_REQUIRED') {
      context.addIssue({
        code: 'custom',
        path: ['releaseStatus'],
        message: 'Release não aplicável.',
      });
    }
  });

const sandboxOutputMetadataSchema = z
  .object({
    observedBytes: z.number().int().nonnegative(),
    observedLines: z.number().int().nonnegative(),
    truncated: z.boolean(),
    summaryHash: factoryPipelineHashSchema,
  })
  .strict();

export const factorySandboxStepSummarySchema = z
  .object({
    stepId: z.enum(['PREPARE', 'TYPECHECK', 'BUILD', 'TEST']),
    status: z.enum(['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'SKIPPED']),
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    exitCode: z.number().int().nullable(),
    resourceOutcome: z.enum(['NONE', 'OOM', 'PID_LIMIT', 'DISK_LIMIT', 'OUTPUT_LIMIT', 'UNKNOWN']),
    stdout: sandboxOutputMetadataSchema.nullable(),
    stderr: sandboxOutputMetadataSchema.nullable(),
    failure: z
      .object({
        code: z.string().trim().min(1).max(128),
        stage: z.string().trim().min(1).max(64),
        sourceCode: z.string().trim().min(1).max(128).nullable(),
        reasonCode: z
          .string()
          .regex(/^[A-Z][A-Z0-9_]{1,63}$/u)
          .nullable(),
        diagnosticSummary: factoryTypeScriptDiagnosticSummarySchema.nullable(),
        message: z.string().trim().min(1).max(300),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((step, context) => {
    if (
      step.failure?.diagnosticSummary !== null &&
      step.failure?.diagnosticSummary !== undefined &&
      (step.stepId !== 'TYPECHECK' ||
        step.status !== 'FAILED' ||
        step.failure.reasonCode !== 'TYPESCRIPT_DIAGNOSTICS')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failure', 'diagnosticSummary'],
        message: 'Diagnósticos TypeScript pertencem somente a uma falha de typecheck.',
      });
    }
  });

const factorySandboxCleanupFailureSchema = z
  .object({
    code: z.literal('SANDBOX_CLEANUP_FAILED'),
    stage: z.literal('CLEANUP'),
    sourceCode: z.string().trim().min(1).max(128).nullable(),
    reasonCode: z.null(),
    diagnosticSummary: z.null(),
    message: z.string().trim().min(1).max(300),
  })
  .strict();

export const factorySandboxSummarySchema = z
  .object({
    status: z.enum(['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'SKIPPED']),
    sandboxRunId: z
      .string()
      .regex(/^sandbox-[a-f0-9]{32}$/u)
      .nullable(),
    resourceOutcome: z.enum(['NONE', 'OOM', 'PID_LIMIT', 'DISK_LIMIT', 'OUTPUT_LIMIT', 'UNKNOWN']),
    steps: z.array(factorySandboxStepSummarySchema).length(4),
    cleanupFailure: factorySandboxCleanupFailureSchema.nullable().default(null),
    hashes: z
      .object({
        policyHash: factoryPipelineHashSchema,
        commandPolicyHash: factoryPipelineHashSchema,
        limitsHash: factoryPipelineHashSchema,
        sandboxRequestHash: factoryPipelineHashSchema,
        sandboxResultHash: factoryPipelineHashSchema,
      })
      .strict()
      .nullable(),
    provenance: z
      .object({
        runnerVersion: semanticVersionSchema,
        contractVersion: semanticVersionSchema,
        sanitizerVersion: semanticVersionSchema,
        policyId: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
        policyVersion: semanticVersionSchema,
        packageManager: z.enum(['NONE', 'NPM']),
        helperAbiVersion: semanticVersionSchema,
        dependencySnapshotHash: factoryPipelineHashSchema.nullable(),
        policyHash: factoryPipelineHashSchema,
        commandPolicyHash: factoryPipelineHashSchema,
        limitsHash: factoryPipelineHashSchema,
        adapter: identifierSchema,
        imageReference: z.string().trim().min(1).max(512),
        imageDigest: factoryPipelinePrefixedHashSchema,
        imageId: z.string().trim().min(1).max(256),
        platform: z.string().trim().min(1).max(128),
        runtimeName: identifierSchema,
        runtimeVersion: z.string().trim().min(1).max(128),
        toolchainVersions: z.record(identifierSchema, z.string().trim().min(1).max(128)),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((summary, context) => {
    const skipped = summary.status === 'SKIPPED';
    const hasNoIdentity =
      summary.sandboxRunId === null && summary.hashes === null && summary.provenance === null;
    if (skipped && !hasNoIdentity) {
      context.addIssue({ code: 'custom', message: 'Sandbox SKIPPED não possui identidade.' });
    }
    if (
      (summary.sandboxRunId === null || summary.hashes === null || summary.provenance === null) &&
      !hasNoIdentity
    ) {
      context.addIssue({ code: 'custom', message: 'Identidade parcial da sandbox é inválida.' });
    }
    const order = ['PREPARE', 'TYPECHECK', 'BUILD', 'TEST'];
    summary.steps.forEach((step, index) => {
      if (step.stepId !== order[index]) {
        context.addIssue({ code: 'custom', path: ['steps', index], message: 'Ordem inválida.' });
      }
    });
  });

export const factoryPipelineLineageSchema = z
  .object({
    productOwnerSpecificationHash: factoryPipelinePrefixedHashSchema.nullable(),
    technicalSpecificationHash: factoryPipelinePrefixedHashSchema.nullable(),
    qaSpecificationHash: factoryPipelinePrefixedHashSchema.nullable(),
    executionHash: factoryPipelineHashSchema,
    workflowHash: factoryPipelineHashSchema.nullable(),
    generatedBundleHash: factoryPipelineHashSchema.nullable(),
    workspacePlanHash: factoryPipelineHashSchema.nullable(),
    workspaceHash: factoryPipelineHashSchema.nullable(),
    sandboxRequestHash: factoryPipelineHashSchema.nullable(),
    sandboxResultHash: factoryPipelineHashSchema.nullable(),
    executionProfileHash: factoryPipelineHashSchema,
    generationProjectionHash: factoryPipelineHashSchema,
    profileValidationHash: factoryPipelineHashSchema.nullable(),
  })
  .strict();

export const factoryPipelineProvenanceSchema = z
  .object({
    pipelineVersion: z.literal(FACTORY_PIPELINE_VERSION),
    contractVersion: z.literal(FACTORY_PIPELINE_CONTRACT_VERSION),
    hashAlgorithm: z.literal(FACTORY_PIPELINE_HASH_ALGORITHM),
    executionEngine: z
      .object({ engineVersion: semanticVersionSchema, contractVersion: semanticVersionSchema })
      .strict(),
    agents: z
      .object({
        productOwner: semanticVersionSchema.nullable(),
        developer: semanticVersionSchema.nullable(),
        qa: semanticVersionSchema.nullable(),
        codeGenerator: semanticVersionSchema,
      })
      .strict(),
    executionProfile: z
      .object({
        profileId: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
        version: semanticVersionSchema,
        contractVersion: semanticVersionSchema,
        profileHash: factoryPipelineHashSchema,
        generationProjectionHash: factoryPipelineHashSchema,
        profileValidationHash: factoryPipelineHashSchema.nullable(),
      })
      .strict(),
    codeGenerator: z
      .object({
        contractVersion: semanticVersionSchema,
        assetBundleHash: factoryPipelineHashSchema,
      })
      .strict()
      .nullable(),
    workspace: z
      .object({
        workspaceVersion: semanticVersionSchema,
        contractVersion: semanticVersionSchema,
        policyHash: factoryPipelineHashSchema,
        configurationHash: factoryPipelineHashSchema,
      })
      .strict()
      .nullable(),
    sandbox: z
      .object({
        runnerVersion: semanticVersionSchema,
        contractVersion: semanticVersionSchema,
        sanitizerVersion: semanticVersionSchema,
        policyId: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
        policyVersion: semanticVersionSchema,
        helperAbiVersion: semanticVersionSchema,
        dependencySnapshotHash: factoryPipelineHashSchema.nullable(),
        policyHash: factoryPipelineHashSchema,
        commandPolicyHash: factoryPipelineHashSchema,
        limitsHash: factoryPipelineHashSchema,
        adapter: identifierSchema,
        imageDigest: factoryPipelinePrefixedHashSchema,
        imageId: z.string().trim().min(1).max(256),
        platform: z.string().trim().min(1).max(128),
        runtimeName: identifierSchema,
        runtimeVersion: z.string().trim().min(1).max(128),
        toolchainVersions: z.record(identifierSchema, z.string().trim().min(1).max(128)),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const factoryPipelineHashesSchema = z
  .object({
    executionHash: factoryPipelineHashSchema,
    workflowHash: factoryPipelineHashSchema.nullable(),
    generationHash: factoryPipelineHashSchema.nullable(),
    bundleHash: factoryPipelineHashSchema.nullable(),
    workspacePlanHash: factoryPipelineHashSchema.nullable(),
    workspaceHash: factoryPipelineHashSchema.nullable(),
    sandboxRequestHash: factoryPipelineHashSchema.nullable(),
    sandboxResultHash: factoryPipelineHashSchema.nullable(),
    lineageHash: factoryPipelineHashSchema,
    provenanceHash: factoryPipelineHashSchema,
    factoryResultHash: factoryPipelineHashSchema,
  })
  .strict();

export const factoryExecutionResultSchema = z
  .object({
    executionId: identifierSchema,
    workflowId: identifierSchema,
    status: factoryPipelineStatusSchema,
    terminalStage: z.union([
      factoryPipelineStageIdSchema,
      z.literal('EXECUTION'),
      z.literal('SANDBOX'),
    ]),
    startedAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema,
    durationMs: z.number().int().nonnegative(),
    metadata: z
      .object({
        pipelineVersion: z.literal(FACTORY_PIPELINE_VERSION),
        contractVersion: z.literal(FACTORY_PIPELINE_CONTRACT_VERSION),
        attempt: z.literal(1),
      })
      .strict(),
    stages: z.array(factoryPipelineStageResultSchema).length(FACTORY_PIPELINE_STAGE_IDS.length),
    execution: factorySourceExecutionSummarySchema,
    agents: factoryAgentsSummarySchema,
    generation: factoryGenerationSummarySchema,
    workspace: factoryWorkspaceSummarySchema,
    sandbox: factorySandboxSummarySchema,
    lineage: factoryPipelineLineageSchema,
    provenance: factoryPipelineProvenanceSchema,
    hashes: factoryPipelineHashesSchema,
    failure: factoryPipelineFailureSchema.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if (Date.parse(result.finishedAt) < Date.parse(result.startedAt)) {
      context.addIssue({ code: 'custom', path: ['finishedAt'], message: 'Término inválido.' });
    }
    result.stages.forEach((stage, index) => {
      if (stage.stageId !== FACTORY_PIPELINE_STAGE_IDS[index]) {
        context.addIssue({
          code: 'custom',
          path: ['stages', index, 'stageId'],
          message: 'As etapas devem preservar a ordem canônica.',
        });
      }
    });
    const allSucceeded = result.stages.every((stage) => stage.status === 'SUCCESS');
    if (result.status === 'SUCCESS' && (!allSucceeded || result.failure !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'SUCCESS exige todas as etapas.',
      });
    }
    if (result.status !== 'SUCCESS' && result.failure === null) {
      context.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'Falha terminal obrigatória.',
      });
    }
    if (
      result.status === 'CANCELLED' &&
      !result.stages.some((stage) => stage.status === 'CANCELLED')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['stages'],
        message: 'Cancelamento não observado.',
      });
    }
    if (result.failure !== null && result.failure.stage !== result.terminalStage) {
      context.addIssue({
        code: 'custom',
        path: ['terminalStage'],
        message: 'Etapa terminal divergente.',
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
        message: 'A falha terminal deve preservar a mesma regra estrutural da etapa.',
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
        message: 'A falha terminal deve preservar o diagnóstico seguro da etapa.',
      });
    }
    const expectedLineageHash = calculateFactoryPipelineLineageHash(result.lineage);
    const expectedProvenanceHash = calculateFactoryPipelineProvenanceHash(result.provenance);
    const { factoryResultHash, ...hashesWithoutResult } = result.hashes;
    const expectedResultHash = calculateFactoryPipelineResultHash({
      ...result,
      hashes: hashesWithoutResult,
    });
    if (
      result.hashes.executionHash !== result.execution.hashes.executionHash ||
      result.hashes.workflowHash !== result.execution.hashes.workflowHash ||
      result.hashes.executionHash !== result.lineage.executionHash ||
      result.hashes.workflowHash !== result.lineage.workflowHash ||
      result.hashes.generationHash !== (result.generation.hashes?.generationHash ?? null) ||
      result.hashes.bundleHash !== result.lineage.generatedBundleHash ||
      result.hashes.workspacePlanHash !== result.lineage.workspacePlanHash ||
      result.hashes.workspaceHash !== result.lineage.workspaceHash ||
      result.hashes.sandboxRequestHash !== result.lineage.sandboxRequestHash ||
      result.hashes.sandboxResultHash !== result.lineage.sandboxResultHash
    ) {
      context.addIssue({ code: 'custom', path: ['hashes'], message: 'Hash chain divergente.' });
    }
    if (
      result.hashes.lineageHash !== expectedLineageHash ||
      result.hashes.provenanceHash !== expectedProvenanceHash ||
      factoryResultHash !== expectedResultHash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['hashes', 'factoryResultHash'],
        message: 'Hashes do Factory result são inconsistentes.',
      });
    }
  });
