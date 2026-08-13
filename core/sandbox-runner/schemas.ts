import { workspaceMaterializationResultSchema } from '@brq/controlled-workspace';
import { identifierSchema, isoDateTimeSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

import { sandboxLimitReductionsSchema } from './configuration';
import { SANDBOX_RUNNER_ERROR_CODES, SANDBOX_RUNNER_ERROR_STAGES } from './errors';
import {
  SANDBOX_STEP_IDS,
  SANDBOX_STEP_TERMINAL_STATUSES,
  SANDBOX_TERMINAL_STATUSES,
} from './lifecycle';
import { SANDBOX_ABSOLUTE_LIMITS } from './limits';
import {
  calculateSandboxOutputHash,
  calculateSandboxResultHash,
  deriveSandboxRunId,
} from './hashing';
import { sandboxPackageManagerSchema } from './policies';
import {
  SANDBOX_OUTPUT_SANITIZER_VERSION,
  SANDBOX_RUNNER_CONTRACT_VERSION,
  SANDBOX_RUNNER_HASH_ALGORITHM,
  SANDBOX_RUNNER_VERSION,
} from './version';

const HASH = /^[a-f0-9]{64}$/u;
const PREFIXED_HASH = /^sha256:[a-f0-9]{64}$/u;
const SEMANTIC_VERSION = /^\d+\.\d+\.\d+$/u;
const TECHNICAL_CONTEXT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const EVIDENT_SECRET_CONTEXT_ID =
  /^(?:sk[-_]|gh[opusr]_|npm_|eyJ)|(?:^|[._:-])(?:authorization|bearer|password|secret|token|api[-_]?key)(?:[._:-]|$)/iu;
const PREPARE_PROJECTED_LIFECYCLE_STAGES: ReadonlySet<string> = new Set([
  SANDBOX_RUNNER_ERROR_STAGES.CONFIGURATION,
  SANDBOX_RUNNER_ERROR_STAGES.REQUEST_VALIDATION,
  SANDBOX_RUNNER_ERROR_STAGES.CAPACITY,
  SANDBOX_RUNNER_ERROR_STAGES.INTEGRITY,
  SANDBOX_RUNNER_ERROR_STAGES.IMAGE,
  SANDBOX_RUNNER_ERROR_STAGES.START,
  SANDBOX_RUNNER_ERROR_STAGES.CLEANUP,
]);

export const sandboxHashSchema = z.string().regex(HASH);
export const sandboxRunIdSchema = z.string().regex(/^sandbox-[a-f0-9]{32}$/u);
export const sandboxStepIdSchema = z.enum(SANDBOX_STEP_IDS);
export const sandboxStatusSchema = z.enum(SANDBOX_TERMINAL_STATUSES);
export const sandboxStepStatusSchema = z.enum(SANDBOX_STEP_TERMINAL_STATUSES);
export const sandboxResourceOutcomeSchema = z.enum([
  'NONE',
  'OOM',
  'PID_LIMIT',
  'DISK_LIMIT',
  'OUTPUT_LIMIT',
  'UNKNOWN',
]);

export const sandboxTechnicalContextIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(TECHNICAL_CONTEXT_ID)
  .refine((value) => !EVIDENT_SECRET_CONTEXT_ID.test(value), {
    message: 'O identificador técnico não pode conter um padrão evidente de segredo.',
  });

export const sandboxContextSchema = z
  .object({
    executionId: sandboxTechnicalContextIdSchema,
    requestId: sandboxTechnicalContextIdSchema.optional(),
    traceId: sandboxTechnicalContextIdSchema.optional(),
  })
  .strict();

export const sandboxRunRequestSchema = z
  .object({
    context: sandboxContextSchema,
    workspace: workspaceMaterializationResultSchema,
    policyId: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
    limits: sandboxLimitReductionsSchema.optional(),
  })
  .strict();

export const SANDBOX_TYPESCRIPT_DIAGNOSTIC_COUNT_LIMIT = 10_000;
export const SANDBOX_TYPESCRIPT_DIAGNOSTIC_CODE_LIMIT = 32;
export const SANDBOX_TYPESCRIPT_DIAGNOSTIC_CODE_MAX = 99_999;

export const sandboxDiagnosticSummarySchema = z
  .object({
    diagnosticCount: z.number().int().positive().max(SANDBOX_TYPESCRIPT_DIAGNOSTIC_COUNT_LIMIT),
    diagnosticCodes: z
      .array(z.number().int().positive().max(SANDBOX_TYPESCRIPT_DIAGNOSTIC_CODE_MAX))
      .min(1)
      .max(SANDBOX_TYPESCRIPT_DIAGNOSTIC_CODE_LIMIT),
    truncated: z.boolean(),
  })
  .strict()
  .superRefine((summary, context) => {
    if (summary.diagnosticCodes.length > summary.diagnosticCount) {
      context.addIssue({
        code: 'custom',
        path: ['diagnosticCodes'],
        message: 'A quantidade de códigos não pode exceder a contagem de diagnósticos.',
      });
    }
    if (
      summary.diagnosticCodes.some(
        (code, index) => index > 0 && code <= summary.diagnosticCodes[index - 1]!,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['diagnosticCodes'],
        message: 'Os códigos de diagnóstico devem ser únicos e ordenados.',
      });
    }
  });

export const sandboxEffectiveLimitsSchema = z
  .object({
    cpus: z.number().positive().max(SANDBOX_ABSOLUTE_LIMITS.cpus),
    memoryBytes: z.number().int().positive().max(SANDBOX_ABSOLUTE_LIMITS.memoryBytes),
    pidsLimit: z.number().int().positive().max(SANDBOX_ABSOLUTE_LIMITS.pidsLimit),
    openFilesLimit: z.number().int().positive().max(SANDBOX_ABSOLUTE_LIMITS.openFilesLimit),
    workspaceBytes: z.number().int().positive().max(SANDBOX_ABSOLUTE_LIMITS.workspaceBytes),
    workspaceInodes: z.number().int().positive().max(SANDBOX_ABSOLUTE_LIMITS.workspaceInodes),
    temporaryBytes: z.number().int().positive().max(SANDBOX_ABSOLUTE_LIMITS.temporaryBytes),
    temporaryInodes: z.number().int().positive().max(SANDBOX_ABSOLUTE_LIMITS.temporaryInodes),
    totalTimeoutMs: z.number().int().positive().max(SANDBOX_ABSOLUTE_LIMITS.totalTimeoutMs),
    prepareTimeoutMs: z.number().int().positive().max(SANDBOX_ABSOLUTE_LIMITS.prepareTimeoutMs),
    typecheckTimeoutMs: z.number().int().positive().max(SANDBOX_ABSOLUTE_LIMITS.typecheckTimeoutMs),
    buildTimeoutMs: z.number().int().positive().max(SANDBOX_ABSOLUTE_LIMITS.buildTimeoutMs),
    testTimeoutMs: z.number().int().positive().max(SANDBOX_ABSOLUTE_LIMITS.testTimeoutMs),
    administrativeTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(SANDBOX_ABSOLUTE_LIMITS.administrativeTimeoutMs),
    capturedOutputBytesPerStream: z
      .number()
      .int()
      .positive()
      .max(SANDBOX_ABSOLUTE_LIMITS.capturedOutputBytesPerStream),
    hardOutputBytesPerStep: z
      .number()
      .int()
      .positive()
      .max(SANDBOX_ABSOLUTE_LIMITS.hardOutputBytesPerStep),
    maxOutputLinesPerStream: z
      .number()
      .int()
      .positive()
      .max(SANDBOX_ABSOLUTE_LIMITS.maxOutputLinesPerStream),
    maxOutputLineBytes: z.number().int().positive().max(SANDBOX_ABSOLUTE_LIMITS.maxOutputLineBytes),
  })
  .strict()
  .refine((limits) => limits.capturedOutputBytesPerStream <= limits.hardOutputBytesPerStep, {
    message: 'A captura deve permanecer abaixo do hard limit de output.',
  });

export const sandboxFailureSchema = z
  .object({
    code: z.enum(Object.values(SANDBOX_RUNNER_ERROR_CODES)),
    stage: z.enum(Object.values(SANDBOX_RUNNER_ERROR_STAGES)),
    message: z.string().trim().min(1).max(300),
    sourceCode: z.string().trim().min(1).max(128).nullable(),
    reasonCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,63}$/u)
      .nullable(),
    diagnosticSummary: sandboxDiagnosticSummarySchema.nullable().default(null),
  })
  .strict()
  .superRefine((failure, context) => {
    if (
      failure.diagnosticSummary !== null &&
      (failure.stage !== 'TYPECHECK' || failure.reasonCode !== 'TYPESCRIPT_DIAGNOSTICS')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['diagnosticSummary'],
        message:
          'Metadata de diagnóstico é permitida somente para TYPESCRIPT_DIAGNOSTICS em TYPECHECK.',
      });
    }
  });

export const sandboxOutputSummarySchema = z
  .object({
    summary: z
      .string()
      .max(SANDBOX_ABSOLUTE_LIMITS.capturedOutputBytesPerStream)
      .refine(
        (value) =>
          Buffer.byteLength(value, 'utf8') <= SANDBOX_ABSOLUTE_LIMITS.capturedOutputBytesPerStream,
        'O summary excede o limite absoluto de bytes.',
      ),
    observedBytes: z.number().int().nonnegative(),
    observedLines: z.number().int().nonnegative(),
    truncated: z.boolean(),
    summaryHash: sandboxHashSchema,
  })
  .strict()
  .superRefine((output, context) => {
    if (output.summaryHash !== calculateSandboxOutputHash(output.summary)) {
      context.addIssue({
        code: 'custom',
        path: ['summaryHash'],
        message: 'O hash deve corresponder ao summary sanitizado.',
      });
    }
  });

export const sandboxStepResultSchema = z
  .object({
    stepId: sandboxStepIdSchema,
    status: sandboxStepStatusSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    exitCode: z.number().int().nullable(),
    timeoutMs: z.number().int().positive().max(SANDBOX_ABSOLUTE_LIMITS.totalTimeoutMs),
    stdout: sandboxOutputSummarySchema.nullable(),
    stderr: sandboxOutputSummarySchema.nullable(),
    resourceOutcome: sandboxResourceOutcomeSchema,
    failure: sandboxFailureSchema.nullable(),
  })
  .strict()
  .superRefine((step, context) => {
    if (step.status === 'SKIPPED') {
      if (
        step.startedAt !== null ||
        step.finishedAt !== null ||
        step.durationMs !== null ||
        step.exitCode !== null ||
        step.stdout !== null ||
        step.stderr !== null ||
        step.resourceOutcome !== 'NONE' ||
        step.failure !== null
      ) {
        context.addIssue({ code: 'custom', message: 'Uma etapa SKIPPED não foi executada.' });
      }
      return;
    }
    if (step.startedAt === null || step.finishedAt === null || step.durationMs === null) {
      context.addIssue({
        code: 'custom',
        message: 'Uma etapa executada exige timestamps e duração terminais.',
      });
      return;
    }
    if (Date.parse(step.finishedAt) < Date.parse(step.startedAt)) {
      context.addIssue({ code: 'custom', message: 'A etapa não pode terminar antes de iniciar.' });
    }
    if (step.stdout === null || step.stderr === null) {
      context.addIssue({ code: 'custom', message: 'Uma etapa executada exige output sanitizado.' });
    }
    if (step.status === 'SUCCESS') {
      if (step.exitCode !== 0 || step.failure !== null || step.resourceOutcome !== 'NONE') {
        context.addIssue({ code: 'custom', message: 'Uma etapa SUCCESS deve encerrar limpa.' });
      }
      return;
    }
    if (step.failure === null) {
      context.addIssue({
        code: 'custom',
        message: 'Uma etapa malsucedida exige falha sanitizada.',
      });
      return;
    }
    if (
      step.failure.diagnosticSummary !== null &&
      !(
        step.stepId === 'TYPECHECK' &&
        step.status === 'FAILED' &&
        step.failure.stage === 'TYPECHECK' &&
        step.failure.reasonCode === 'TYPESCRIPT_DIAGNOSTICS'
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failure', 'diagnosticSummary'],
        message: 'Metadata TypeScript é permitida somente em uma falha de TYPECHECK.',
      });
    }
    const isProjectedPrepareLifecycleFailure =
      step.stepId === 'PREPARE' && PREPARE_PROJECTED_LIFECYCLE_STAGES.has(step.failure.stage);
    if (step.failure.stage !== step.stepId && !isProjectedPrepareLifecycleFailure) {
      context.addIssue({
        code: 'custom',
        path: ['failure', 'stage'],
        message: 'A falha da etapa deve identificar a própria etapa.',
      });
    }
    if (
      (step.status === 'TIMEOUT' && step.failure.code !== SANDBOX_RUNNER_ERROR_CODES.TIMEOUT) ||
      (step.status === 'CANCELLED' && step.failure.code !== SANDBOX_RUNNER_ERROR_CODES.CANCELLED)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failure', 'code'],
        message: 'O código da falha deve corresponder ao status terminal da etapa.',
      });
    }
    if (step.status === 'TIMEOUT' || step.status === 'CANCELLED') {
      if (step.resourceOutcome !== 'NONE') {
        context.addIssue({
          code: 'custom',
          path: ['resourceOutcome'],
          message: 'Timeout e cancelamento não podem declarar resource outcome.',
        });
      }
      return;
    }
    const allowedFailureCodes: readonly string[] = [
      SANDBOX_RUNNER_ERROR_CODES.STEP_FAILED,
      SANDBOX_RUNNER_ERROR_CODES.RESOURCE_LIMIT,
      SANDBOX_RUNNER_ERROR_CODES.OUTPUT_LIMIT,
    ];
    if (!allowedFailureCodes.includes(step.failure.code)) {
      context.addIssue({
        code: 'custom',
        path: ['failure', 'code'],
        message: 'Uma etapa FAILED exige um código de falha de etapa ou recurso.',
      });
    }
    const boundedResource = ['OOM', 'PID_LIMIT', 'DISK_LIMIT'].includes(step.resourceOutcome);
    if (
      (step.failure.code === SANDBOX_RUNNER_ERROR_CODES.OUTPUT_LIMIT) !==
        (step.resourceOutcome === 'OUTPUT_LIMIT') ||
      (step.failure.code === SANDBOX_RUNNER_ERROR_CODES.RESOURCE_LIMIT) !== boundedResource ||
      (step.failure.code === SANDBOX_RUNNER_ERROR_CODES.STEP_FAILED &&
        !['NONE', 'UNKNOWN'].includes(step.resourceOutcome))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['resourceOutcome'],
        message: 'O resource outcome deve corresponder ao código da falha.',
      });
    }
  });

export const sandboxRuntimeObservationSchema = z
  .object({
    adapter: identifierSchema,
    engineName: identifierSchema,
    clientVersion: z.string().trim().min(1).max(128),
    serverVersion: z.string().trim().min(1).max(128),
    imageReference: z.string().trim().min(1).max(512),
    imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    imageId: z.string().trim().min(1).max(256),
    platform: z.string().trim().min(1).max(128),
    runtimeName: identifierSchema,
    runtimeVersion: z.string().trim().min(1).max(128),
    toolchainVersions: z.record(identifierSchema, z.string().trim().min(1).max(128)),
  })
  .strict();

export const sandboxWorkspaceProjectionSchema = z
  .object({
    workspaceId: workspaceMaterializationResultSchema.shape.workspaceId,
    fileCount: z.number().int().positive(),
    totalBytes: z.number().int().nonnegative(),
    planHash: sandboxHashSchema,
    workspaceHash: sandboxHashSchema,
  })
  .strict();

export const sandboxHashesSchema = z
  .object({
    policyHash: sandboxHashSchema,
    commandPolicyHash: sandboxHashSchema,
    limitsHash: sandboxHashSchema,
    sandboxRequestHash: sandboxHashSchema,
    sandboxResultHash: sandboxHashSchema,
  })
  .strict();

export const sandboxLineageSchema = z
  .object({
    technicalSpecificationHash: z.string().regex(PREFIXED_HASH),
    generationHash: sandboxHashSchema,
    bundleHash: sandboxHashSchema,
    bundleContentHash: sandboxHashSchema,
    planHash: sandboxHashSchema,
    workspaceHash: sandboxHashSchema,
    sandboxRequestHash: sandboxHashSchema,
    sandboxResultHash: sandboxHashSchema,
  })
  .strict();

export const sandboxProvenanceSchema = z
  .object({
    runnerVersion: z.literal(SANDBOX_RUNNER_VERSION),
    contractVersion: z.literal(SANDBOX_RUNNER_CONTRACT_VERSION),
    hashAlgorithm: z.literal(SANDBOX_RUNNER_HASH_ALGORITHM),
    sanitizerVersion: z.literal(SANDBOX_OUTPUT_SANITIZER_VERSION),
    policyId: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
    policyVersion: z.string().regex(SEMANTIC_VERSION),
    packageManager: sandboxPackageManagerSchema,
    policyHash: sandboxHashSchema,
    commandPolicyHash: sandboxHashSchema,
    limitsHash: sandboxHashSchema,
    helperAbiVersion: z.string().regex(SEMANTIC_VERSION),
    dependencySnapshotHash: sandboxHashSchema.nullable(),
    runtime: sandboxRuntimeObservationSchema,
  })
  .strict();

export const sandboxRunResultSchema = z
  .object({
    sandboxRunId: sandboxRunIdSchema,
    context: sandboxContextSchema,
    workspace: sandboxWorkspaceProjectionSchema,
    runnerVersion: z.literal(SANDBOX_RUNNER_VERSION),
    contractVersion: z.literal(SANDBOX_RUNNER_CONTRACT_VERSION),
    status: sandboxStatusSchema,
    startedAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema,
    durationMs: z.number().int().nonnegative(),
    steps: z.array(sandboxStepResultSchema).length(SANDBOX_STEP_IDS.length),
    limits: sandboxEffectiveLimitsSchema,
    resourceOutcome: sandboxResourceOutcomeSchema,
    failure: sandboxFailureSchema.nullable(),
    hashes: sandboxHashesSchema,
    lineage: sandboxLineageSchema,
    provenance: sandboxProvenanceSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (Date.parse(result.finishedAt) < Date.parse(result.startedAt)) {
      context.addIssue({ code: 'custom', path: ['finishedAt'], message: 'Término inválido.' });
    }
    result.steps.forEach((step, index) => {
      if (step.stepId !== SANDBOX_STEP_IDS[index]) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'stepId'],
          message: 'As etapas devem preservar a ordem canônica.',
        });
      }
      const timeoutCeiling = {
        PREPARE: result.limits.prepareTimeoutMs,
        TYPECHECK: result.limits.typecheckTimeoutMs,
        BUILD: result.limits.buildTimeoutMs,
        TEST: result.limits.testTimeoutMs,
      }[step.stepId];
      if (step.timeoutMs > timeoutCeiling) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'timeoutMs'],
          message: 'O timeout determinístico da etapa excede o ceiling efetivo.',
        });
      }
    });
    const firstNonSuccess = result.steps.findIndex((step) => step.status !== 'SUCCESS');
    if (firstNonSuccess >= 0) {
      for (let index = firstNonSuccess + 1; index < result.steps.length; index += 1) {
        if (result.steps[index]?.status !== 'SKIPPED') {
          context.addIssue({
            code: 'custom',
            path: ['steps', index, 'status'],
            message: 'Etapas posteriores à interrupção devem ser SKIPPED.',
          });
        }
      }
    }
    const allSucceeded = result.steps.every((step) => step.status === 'SUCCESS');
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
        message: 'Resultado malsucedido exige falha.',
      });
    }
    if (
      allSucceeded &&
      result.status === 'FAILED' &&
      result.failure?.code !== SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failure', 'code'],
        message: 'Somente falha de cleanup pode sobrescrever etapas bem-sucedidas.',
      });
    }
    const interruptedStep = result.steps.find((step) =>
      ['FAILED', 'TIMEOUT', 'CANCELLED'].includes(step.status),
    );
    const cleanupOverridesPrimaryStatus =
      result.status === 'FAILED' &&
      result.failure?.code === SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED;
    if (
      interruptedStep !== undefined &&
      interruptedStep.status !== result.status &&
      !cleanupOverridesPrimaryStatus
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'O status final deve corresponder à etapa que interrompeu o pipeline.',
      });
    }
    if (interruptedStep !== undefined && !cleanupOverridesPrimaryStatus) {
      if (
        result.failure?.code !== interruptedStep.failure?.code ||
        result.failure?.stage !== interruptedStep.failure?.stage ||
        result.failure?.sourceCode !== interruptedStep.failure?.sourceCode ||
        result.failure?.reasonCode !== interruptedStep.failure?.reasonCode ||
        JSON.stringify(result.failure?.diagnosticSummary) !==
          JSON.stringify(interruptedStep.failure?.diagnosticSummary)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['failure'],
          message: 'A falha final deve preservar a falha da etapa que interrompeu o pipeline.',
        });
      }
    }
    const expectedResourceOutcome = interruptedStep?.resourceOutcome ?? 'NONE';
    if (result.resourceOutcome !== expectedResourceOutcome) {
      context.addIssue({
        code: 'custom',
        path: ['resourceOutcome'],
        message: 'O resource outcome final deve preservar o outcome da etapa interrompida.',
      });
    }
    if (result.status === 'TIMEOUT' || result.status === 'CANCELLED') {
      const matching = result.steps.some((step) => step.status === result.status);
      if (!matching) {
        context.addIssue({
          code: 'custom',
          path: ['steps'],
          message: 'Timeout ou cancelamento deve aparecer na etapa interrompida.',
        });
      }
    }
    const workspaceSource = result.lineage;
    if (
      workspaceSource.planHash !== result.workspace.planHash ||
      workspaceSource.workspaceHash !== result.workspace.workspaceHash ||
      workspaceSource.sandboxRequestHash !== result.hashes.sandboxRequestHash ||
      workspaceSource.sandboxResultHash !== result.hashes.sandboxResultHash ||
      result.provenance.policyHash !== result.hashes.policyHash ||
      result.provenance.commandPolicyHash !== result.hashes.commandPolicyHash ||
      result.provenance.limitsHash !== result.hashes.limitsHash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['hashes'],
        message: 'Lineage/provenance divergente.',
      });
    }
    if (result.sandboxRunId !== deriveSandboxRunId(result.hashes.sandboxRequestHash)) {
      context.addIssue({
        code: 'custom',
        path: ['sandboxRunId'],
        message: 'sandboxRunId deve derivar do request hash.',
      });
    }
    const expectedResultHash = calculateSandboxResultHash({
      sandboxRunId: result.sandboxRunId,
      sandboxRequestHash: result.hashes.sandboxRequestHash,
      status: result.status,
      workspaceHash: result.workspace.workspaceHash,
      steps: result.steps,
      resourceOutcome: result.resourceOutcome,
      failure:
        result.failure === null
          ? null
          : {
              code: result.failure.code,
              stage: result.failure.stage,
              sourceCode: result.failure.sourceCode,
              reasonCode: result.failure.reasonCode,
              diagnosticSummary: result.failure.diagnosticSummary,
            },
      policyHash: result.hashes.policyHash,
      commandPolicyHash: result.hashes.commandPolicyHash,
      limitsHash: result.hashes.limitsHash,
      runtimeIdentity: result.provenance.runtime,
    });
    if (expectedResultHash !== result.hashes.sandboxResultHash) {
      context.addIssue({
        code: 'custom',
        path: ['hashes', 'sandboxResultHash'],
        message: 'sandboxResultHash não corresponde ao resultado terminal.',
      });
    }
  });
