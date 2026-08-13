import type { z } from 'zod';

import { classifyAdaptiveRequest } from './classifier';
import type {
  AdaptiveCheckpoint,
  AdaptiveClassification,
  AdaptiveExecutionRequest,
  AdaptiveExecutionResult,
  AdaptiveLedger,
  AdaptiveOrchestrator,
  AdaptivePlan,
  BuilderPortResult,
  CreateAdaptiveOrchestratorOptions,
  TokenUsage,
  VerifierPortResult,
} from './contracts';
import {
  ADAPTIVE_ORCHESTRATOR_ERROR_CODES as ERRORS,
  AdaptiveOrchestratorError,
  type AdaptiveOrchestratorErrorCode,
  type AdaptiveRole,
} from './errors';
import { domainHash } from './hashing';
import { deepFreeze } from './immutability';
import {
  adaptiveCheckpointPayloadSchema,
  adaptiveCheckpointSchema,
  adaptiveExecutionRequestSchema,
  adaptiveExecutionResultSchema,
  builderPortResultSchema,
  createAdaptiveOrchestratorOptionsSchema,
  plannerPortResultSchema,
  verifierPortResultSchema,
} from './schemas';
import { ADAPTIVE_ORCHESTRATOR_CONTRACT_VERSION } from './version';

interface MutableUsage {
  inputTokens: number;
  outputTokens: number;
}

interface MutableLedger {
  calls: {
    classifier: 1;
    planner: number;
    builder: number;
    verifier: number;
    reviewer: number;
  };
  tokens: {
    planner: MutableUsage;
    builder: MutableUsage;
    verifier: MutableUsage;
    reviewer: MutableUsage;
  };
}

function fail(code: AdaptiveOrchestratorErrorCode, message: string, role?: AdaptiveRole): never {
  throw new AdaptiveOrchestratorError(message, role === undefined ? { code } : { code, role });
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    fail(ERRORS.SAFE_INTEGER_EXCEEDED, 'Adaptive orchestration metrics exceeded safe integers.');
  }
  return result;
}

function emptyUsage(): MutableUsage {
  return { inputTokens: 0, outputTokens: 0 };
}

function createLedger(): MutableLedger {
  return {
    calls: { classifier: 1, planner: 0, builder: 0, verifier: 0, reviewer: 0 },
    tokens: {
      planner: emptyUsage(),
      builder: emptyUsage(),
      verifier: emptyUsage(),
      reviewer: emptyUsage(),
    },
  };
}

function hydrateLedger(ledger: AdaptiveLedger): MutableLedger {
  return {
    calls: { ...ledger.calls },
    tokens: {
      planner: {
        inputTokens: ledger.tokens.planner.inputTokens,
        outputTokens: ledger.tokens.planner.outputTokens,
      },
      builder: {
        inputTokens: ledger.tokens.builder.inputTokens,
        outputTokens: ledger.tokens.builder.outputTokens,
      },
      verifier: {
        inputTokens: ledger.tokens.verifier.inputTokens,
        outputTokens: ledger.tokens.verifier.outputTokens,
      },
      reviewer: {
        inputTokens: ledger.tokens.reviewer.inputTokens,
        outputTokens: ledger.tokens.reviewer.outputTokens,
      },
    },
  };
}

function recordUsage(
  ledger: MutableLedger,
  role: 'planner' | 'builder' | 'reviewer',
  usage: TokenUsage,
): void {
  ledger.tokens[role].inputTokens = safeAdd(ledger.tokens[role].inputTokens, usage.inputTokens);
  ledger.tokens[role].outputTokens = safeAdd(ledger.tokens[role].outputTokens, usage.outputTokens);
}

function roleUsage(usage: MutableUsage): AdaptiveLedger['tokens']['planner'] {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: safeAdd(usage.inputTokens, usage.outputTokens),
  };
}

function finalizeLedger(ledger: MutableLedger): AdaptiveLedger {
  const planner = roleUsage(ledger.tokens.planner);
  const builder = roleUsage(ledger.tokens.builder);
  const verifier = roleUsage(ledger.tokens.verifier);
  const reviewer = roleUsage(ledger.tokens.reviewer);
  const inputTokens = [planner, builder, verifier, reviewer].reduce(
    (total, usage) => safeAdd(total, usage.inputTokens),
    0,
  );
  const outputTokens = [planner, builder, verifier, reviewer].reduce(
    (total, usage) => safeAdd(total, usage.outputTokens),
    0,
  );
  return deepFreeze({
    calls: { ...ledger.calls },
    tokens: {
      planner,
      builder,
      verifier,
      reviewer,
      total: {
        inputTokens,
        outputTokens,
        totalTokens: safeAdd(inputTokens, outputTokens),
      },
    },
  });
}

async function invokePort<Result>(
  role: AdaptiveRole,
  operation: () => Promise<unknown>,
  schema: z.ZodType<Result>,
): Promise<Result> {
  let rawResult: unknown;
  try {
    rawResult = await operation();
  } catch {
    fail(ERRORS.PORT_EXECUTION_FAILED, 'An adaptive orchestration port failed.', role);
  }
  const parsed = schema.safeParse(rawResult);
  if (!parsed.success) {
    fail(
      ERRORS.INVALID_PORT_RESULT,
      'An adaptive orchestration port returned an invalid result.',
      role,
    );
  }
  return parsed.data;
}

function requestHash(request: AdaptiveExecutionRequest): string {
  return domainHash('brq-adaptive-orchestrator:request:v1', request);
}

function planHash(requestDigest: string, steps: AdaptivePlan['steps']): string {
  return domainHash('brq-adaptive-orchestrator:plan:v1', {
    requestHash: requestDigest,
    steps,
  });
}

function checkpointPayload(checkpoint: AdaptiveCheckpoint) {
  return {
    contractVersion: checkpoint.contractVersion,
    request: checkpoint.request,
    requestHash: checkpoint.requestHash,
    classification: checkpoint.classification,
    plan: checkpoint.plan,
    candidate: checkpoint.candidate,
    repairAttemptsUsed: checkpoint.repairAttemptsUsed,
    maxRepairAttempts: checkpoint.maxRepairAttempts,
    ledger: checkpoint.ledger,
  };
}

function calculateCheckpointHash(payload: unknown): string {
  return domainHash('brq-adaptive-orchestrator:checkpoint:v1', payload);
}

function createCheckpoint(input: {
  request: AdaptiveExecutionRequest;
  classification: AdaptiveClassification;
  plan: AdaptivePlan | null;
  candidate: BuilderPortResult['candidate'];
  repairAttemptsUsed: number;
  maxRepairAttempts: number;
  ledger: AdaptiveLedger;
}): AdaptiveCheckpoint {
  const payload = adaptiveCheckpointPayloadSchema.parse({
    contractVersion: ADAPTIVE_ORCHESTRATOR_CONTRACT_VERSION,
    request: input.request,
    requestHash: requestHash(input.request),
    classification: input.classification,
    plan: input.plan,
    candidate: input.candidate,
    repairAttemptsUsed: input.repairAttemptsUsed,
    maxRepairAttempts: input.maxRepairAttempts,
    ledger: input.ledger,
  });
  return deepFreeze(
    adaptiveCheckpointSchema.parse({
      ...payload,
      checkpointHash: calculateCheckpointHash(payload),
    }),
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return (
    domainHash('brq-adaptive-orchestrator:equality:v1', left) ===
    domainHash('brq-adaptive-orchestrator:equality:v1', right)
  );
}

function validateCheckpoint(
  rawCheckpoint: AdaptiveCheckpoint,
  maxRepairAttempts: number,
): AdaptiveCheckpoint {
  const parsed = adaptiveCheckpointSchema.safeParse(rawCheckpoint);
  if (!parsed.success) {
    fail(ERRORS.CHECKPOINT_INVALID, 'The adaptive checkpoint is invalid.');
  }
  const checkpoint = parsed.data;
  const payload = checkpointPayload(checkpoint);
  const expectedClassification = classifyAdaptiveRequest(checkpoint.request);
  const expectedPlannerCalls = checkpoint.classification.route === 'PLANNED' ? 1 : 0;
  const planIsConsistent =
    checkpoint.classification.route === 'PLANNED'
      ? checkpoint.plan !== null &&
        checkpoint.plan.planHash === planHash(checkpoint.requestHash, checkpoint.plan.steps)
      : checkpoint.plan === null;
  const inactiveRoleHasNoTokens =
    (checkpoint.ledger.calls.planner !== 0 || checkpoint.ledger.tokens.planner.totalTokens === 0) &&
    (checkpoint.ledger.calls.reviewer !== 0 || checkpoint.ledger.tokens.reviewer.totalTokens === 0);

  if (
    checkpoint.checkpointHash !== calculateCheckpointHash(payload) ||
    checkpoint.requestHash !== requestHash(checkpoint.request) ||
    !sameValue(checkpoint.classification, expectedClassification) ||
    !planIsConsistent ||
    checkpoint.ledger.calls.planner !== expectedPlannerCalls ||
    checkpoint.ledger.calls.builder !== 1 ||
    checkpoint.ledger.calls.verifier < 1 ||
    checkpoint.ledger.calls.reviewer !== checkpoint.repairAttemptsUsed ||
    checkpoint.repairAttemptsUsed > checkpoint.maxRepairAttempts ||
    !inactiveRoleHasNoTokens
  ) {
    fail(ERRORS.CHECKPOINT_INVALID, 'The adaptive checkpoint failed integrity validation.');
  }
  if (checkpoint.maxRepairAttempts !== maxRepairAttempts) {
    fail(ERRORS.CHECKPOINT_POLICY_MISMATCH, 'The adaptive checkpoint repair policy changed.');
  }
  return deepFreeze(checkpoint);
}

function finalizeResult(candidate: unknown): AdaptiveExecutionResult {
  const parsed = adaptiveExecutionResultSchema.safeParse(candidate);
  if (!parsed.success) {
    fail(ERRORS.CONTRACT_VIOLATION, 'Adaptive orchestration produced an invalid result.');
  }
  return deepFreeze(parsed.data);
}

export function createAdaptiveOrchestrator(
  options: CreateAdaptiveOrchestratorOptions,
): AdaptiveOrchestrator {
  const configuration = createAdaptiveOrchestratorOptionsSchema.safeParse({
    maxRepairAttempts: options?.maxRepairAttempts,
  });
  if (
    !configuration.success ||
    typeof options?.builder?.build !== 'function' ||
    typeof options?.verifier?.verify !== 'function' ||
    (options.planner !== undefined && typeof options.planner.plan !== 'function') ||
    (options.reviewer !== undefined && typeof options.reviewer.repair !== 'function') ||
    (configuration.success &&
      configuration.data.maxRepairAttempts > 0 &&
      options.reviewer === undefined)
  ) {
    fail(ERRORS.INVALID_CONFIGURATION, 'Adaptive orchestrator configuration is invalid.');
  }

  const maxRepairAttempts = configuration.data.maxRepairAttempts;

  async function verify(
    profile: AdaptiveExecutionRequest['profile'],
    candidate: BuilderPortResult['candidate'],
    ledger: MutableLedger,
  ): Promise<VerifierPortResult> {
    ledger.calls.verifier = safeAdd(ledger.calls.verifier, 1);
    return invokePort(
      'VERIFIER',
      () => options.verifier.verify({ profile, candidate }),
      verifierPortResultSchema,
    );
  }

  async function execute(rawRequest: AdaptiveExecutionRequest): Promise<AdaptiveExecutionResult> {
    const parsedRequest = adaptiveExecutionRequestSchema.safeParse(rawRequest);
    if (!parsedRequest.success) {
      fail(ERRORS.INVALID_REQUEST, 'The adaptive orchestration request is invalid.');
    }
    const request = deepFreeze(parsedRequest.data);
    const classification = classifyAdaptiveRequest(request);
    const digest = requestHash(request);
    const ledger = createLedger();
    let plan: AdaptivePlan | null = null;

    if (classification.route === 'PLANNED') {
      if (options.planner === undefined) {
        fail(ERRORS.PLANNER_REQUIRED, 'The planned route requires a planner.', 'PLANNER');
      }
      ledger.calls.planner = 1;
      const planned = await invokePort(
        'PLANNER',
        () =>
          options.planner!.plan({
            demand: request.demand,
            profile: request.profile,
            routingSignals: request.routingSignals,
          }),
        plannerPortResultSchema,
      );
      recordUsage(ledger, 'planner', planned.usage);
      plan = deepFreeze({ planHash: planHash(digest, planned.steps), steps: planned.steps });
    }

    ledger.calls.builder = 1;
    let built = await invokePort(
      'BUILDER',
      () =>
        options.builder.build({
          demand: request.demand,
          profile: request.profile,
          plan,
          feedback: null,
        }),
      builderPortResultSchema,
    );
    recordUsage(ledger, 'builder', built.usage);

    let verification = await verify(request.profile, built.candidate, ledger);
    let repairAttemptsUsed = 0;

    while (verification.status === 'CODE_FAILURE' && repairAttemptsUsed < maxRepairAttempts) {
      if (options.reviewer === undefined) {
        fail(ERRORS.INVALID_CONFIGURATION, 'The configured repair policy requires a reviewer.');
      }
      repairAttemptsUsed = safeAdd(repairAttemptsUsed, 1);
      ledger.calls.reviewer = safeAdd(ledger.calls.reviewer, 1);
      const feedback = verification.diagnostic;
      built = await invokePort(
        'REVIEWER',
        () =>
          options.reviewer!.repair({
            demand: request.demand,
            profile: request.profile,
            plan,
            candidate: built.candidate,
            feedback,
            repairAttempt: repairAttemptsUsed,
          }),
        builderPortResultSchema,
      );
      recordUsage(ledger, 'reviewer', built.usage);
      verification = await verify(request.profile, built.candidate, ledger);
    }

    const finalizedLedger = finalizeLedger(ledger);
    const base = {
      contractVersion: ADAPTIVE_ORCHESTRATOR_CONTRACT_VERSION,
      route: classification.route,
      plan,
      candidate: built.candidate,
      ledger: finalizedLedger,
    } as const;

    if (verification.status === 'SUCCESS') {
      return finalizeResult({
        ...base,
        status: 'SUCCESS',
        verificationHash: verification.verificationHash,
        diagnostic: null,
        checkpoint: null,
      });
    }
    if (verification.status === 'CODE_FAILURE') {
      return finalizeResult({
        ...base,
        status: 'FAILED',
        verificationHash: null,
        diagnostic: verification.diagnostic,
        checkpoint: null,
      });
    }

    const checkpoint = createCheckpoint({
      request,
      classification,
      plan,
      candidate: built.candidate,
      repairAttemptsUsed,
      maxRepairAttempts,
      ledger: finalizedLedger,
    });
    return finalizeResult({
      ...base,
      status: 'RESUMABLE',
      verificationHash: null,
      diagnostic: verification.diagnostic,
      checkpoint,
    });
  }

  async function resume(rawCheckpoint: AdaptiveCheckpoint): Promise<AdaptiveExecutionResult> {
    const checkpoint = validateCheckpoint(rawCheckpoint, maxRepairAttempts);
    const ledger = hydrateLedger(checkpoint.ledger);
    const verification = await verify(checkpoint.request.profile, checkpoint.candidate, ledger);
    const finalizedLedger = finalizeLedger(ledger);
    const base = {
      contractVersion: ADAPTIVE_ORCHESTRATOR_CONTRACT_VERSION,
      route: checkpoint.classification.route,
      plan: checkpoint.plan,
      candidate: checkpoint.candidate,
      ledger: finalizedLedger,
    } as const;

    if (verification.status === 'SUCCESS') {
      return finalizeResult({
        ...base,
        status: 'SUCCESS',
        verificationHash: verification.verificationHash,
        diagnostic: null,
        checkpoint: null,
      });
    }
    if (verification.status === 'CODE_FAILURE') {
      return finalizeResult({
        ...base,
        status: 'FAILED',
        verificationHash: null,
        diagnostic: verification.diagnostic,
        checkpoint: null,
      });
    }

    const nextCheckpoint = createCheckpoint({
      request: checkpoint.request,
      classification: checkpoint.classification,
      plan: checkpoint.plan,
      candidate: checkpoint.candidate,
      repairAttemptsUsed: checkpoint.repairAttemptsUsed,
      maxRepairAttempts,
      ledger: finalizedLedger,
    });
    return finalizeResult({
      ...base,
      status: 'RESUMABLE',
      verificationHash: null,
      diagnostic: verification.diagnostic,
      checkpoint: nextCheckpoint,
    });
  }

  return deepFreeze({ execute, resume });
}
