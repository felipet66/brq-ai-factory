import {
  deriveExecutionIdentity,
  executionRequestSchema,
  type ExecutionRequest,
} from '@brq/execution-engine';
import { jobRecordSchema } from '@brq/job-queue';

import type {
  CreateExecutionRerunDispatcherOptions,
  ExecutionRerunDispatchInput,
  ExecutionRerunDispatcher,
} from './contracts';
import { EXECUTION_WORKER_ERROR_CODES, ExecutionWorkerError } from './errors';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXECUTION_ID_PATTERN = /^execution-[a-f0-9]{32}$/;
const REQUIRED_REPLAY_AGENTS = Object.freeze([
  'PRODUCT_OWNER',
  'DEVELOPER',
  'CODE_GENERATOR',
] as const);

function isoNow(now: () => number): string {
  const value = now();
  if (!Number.isFinite(value)) {
    throw new ExecutionWorkerError('Fonte temporal do rerun inválida.', {
      code: EXECUTION_WORKER_ERROR_CODES.INVALID_CLOCK,
    });
  }
  return new Date(Math.max(0, Math.round(value))).toISOString();
}

export function createRerunExecutionRequest(
  source: ExecutionRequest,
  requestId: string,
  technicalId: string,
): ExecutionRequest {
  if (!UUID_PATTERN.test(technicalId)) {
    throw new ExecutionWorkerError('O gerador de identificadores do rerun é inválido.', {
      code: EXECUTION_WORKER_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }

  const request = executionRequestSchema.parse({
    ...source,
    workflowId: `workflow-${technicalId}`,
    requestId,
    traceId: `trace-${technicalId}`,
    agents: {
      productOwner: {
        ...source.agents.productOwner,
        agentExecutionId: `product-owner-${technicalId}`,
      },
      developer: {
        ...source.agents.developer,
        agentExecutionId: `developer-${technicalId}`,
      },
      qa: {
        ...source.agents.qa,
        agentExecutionId: `qa-${technicalId}`,
      },
    },
  });

  if (
    deriveExecutionIdentity(request).executionId === deriveExecutionIdentity(source).executionId
  ) {
    throw new ExecutionWorkerError('O rerun deve possuir uma identidade técnica nova.', {
      code: EXECUTION_WORKER_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }
  return request;
}

export function createExecutionRerunDispatcher(
  options: CreateExecutionRerunDispatcherOptions,
): ExecutionRerunDispatcher {
  if (
    typeof options.snapshots?.findOwned !== 'function' ||
    typeof options.snapshots?.save !== 'function' ||
    typeof options.sourceEligibility?.inspectExecution !== 'function' ||
    typeof options.checkpoints?.inspectExecution !== 'function' ||
    typeof options.cacheOnlyDispatcher?.dispatchCacheOnly !== 'function' ||
    (options.idFactory !== undefined && typeof options.idFactory !== 'function') ||
    (options.now !== undefined && typeof options.now !== 'function')
  ) {
    throw new ExecutionWorkerError('Configuração do dispatcher de rerun inválida.', {
      code: EXECUTION_WORKER_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }
  const idFactory = options.idFactory ?? (() => globalThis.crypto.randomUUID());
  const now = options.now ?? Date.now;

  return Object.freeze({
    async dispatch(input: ExecutionRerunDispatchInput) {
      if (
        typeof input.ownerId !== 'string' ||
        input.ownerId.trim().length === 0 ||
        !EXECUTION_ID_PATTERN.test(input.sourceExecutionId) ||
        typeof input.requestId !== 'string' ||
        input.requestId.trim().length === 0
      ) {
        throw new ExecutionWorkerError('Entrada de rerun inválida.', {
          code: EXECUTION_WORKER_ERROR_CODES.INVALID_CONFIGURATION,
        });
      }

      const snapshot = await options.snapshots.findOwned({
        ownerId: input.ownerId,
        executionId: input.sourceExecutionId,
      });
      if (snapshot === null) {
        throw new ExecutionWorkerError('O snapshot da execução não está disponível.', {
          code: EXECUTION_WORKER_ERROR_CODES.SNAPSHOT_NOT_FOUND,
        });
      }

      const eligibility = await options.sourceEligibility.inspectExecution(input.sourceExecutionId);
      if (
        eligibility === null ||
        eligibility.executionId !== input.sourceExecutionId ||
        !eligibility.terminal ||
        !eligibility.codeGeneratorSucceeded
      ) {
        throw new ExecutionWorkerError(
          'A execução de origem não está terminal ou não concluiu o Code Generator.',
          { code: EXECUTION_WORKER_ERROR_CODES.SOURCE_NOT_ELIGIBLE },
        );
      }

      let inspection;
      try {
        inspection = await options.checkpoints.inspectExecution({
          executionId: input.sourceExecutionId,
          requiredAgents: REQUIRED_REPLAY_AGENTS,
        });
      } catch (error) {
        throw new ExecutionWorkerError('Os checkpoints da execução não estão disponíveis.', {
          code: EXECUTION_WORKER_ERROR_CODES.REGENERATE_REQUIRED,
          cause: error,
        });
      }
      const checkpointAgents = new Set(inspection.checkpoints.map(({ agent }) => agent));
      if (
        !inspection.complete ||
        inspection.executionId !== input.sourceExecutionId ||
        inspection.missingAgents.length !== 0 ||
        REQUIRED_REPLAY_AGENTS.some((agent) => !checkpointAgents.has(agent))
      ) {
        throw new ExecutionWorkerError(
          'O rerun exigiria ao menos uma nova geração e foi bloqueado antes do enqueue.',
          { code: EXECUTION_WORKER_ERROR_CODES.REGENERATE_REQUIRED },
        );
      }

      const request = createRerunExecutionRequest(snapshot.request, input.requestId, idFactory());
      const identity = deriveExecutionIdentity(request);
      const replayCacheExecutionId = snapshot.replayCacheExecutionId ?? snapshot.executionId;

      // Persist before enqueueing so every accepted execution has an immutable replay source.
      await options.snapshots.save({
        ownerId: input.ownerId,
        request,
        replaySourceExecutionId: snapshot.executionId,
        replayCacheExecutionId,
        replayMode: 'REQUIRE_CACHE_HIT',
        createdAt: isoNow(now),
      });

      let rawJob;
      try {
        rawJob = await options.cacheOnlyDispatcher.dispatchCacheOnly(request, {
          mode: 'REQUIRE_CACHE_HIT',
          sourceExecutionId: input.sourceExecutionId,
        });
      } catch (error) {
        const code =
          error !== null &&
          typeof error === 'object' &&
          'code' in error &&
          typeof error.code === 'string'
            ? error.code
            : null;
        if (code === 'AI_PROVIDER_CACHE_MISS') {
          throw new ExecutionWorkerError(
            'O rerun exige respostas idênticas já armazenadas; uma nova geração seria necessária.',
            {
              code: EXECUTION_WORKER_ERROR_CODES.REGENERATE_REQUIRED,
              cause: error,
            },
          );
        }
        throw error;
      }
      const parsedJob = jobRecordSchema.safeParse(rawJob);
      if (
        !parsedJob.success ||
        parsedJob.data.status !== 'QUEUED' ||
        parsedJob.data.executionId !== identity.executionId ||
        parsedJob.data.workflowId !== request.workflowId
      ) {
        throw new ExecutionWorkerError('O dispatcher cache-only retornou um job incompatível.', {
          code: EXECUTION_WORKER_ERROR_CODES.DISPATCH_FAILED,
          ...(!parsedJob.success ? { cause: parsedJob.error } : {}),
        });
      }

      return Object.freeze({
        sourceExecutionId: input.sourceExecutionId,
        executionId: parsedJob.data.executionId,
        jobId: parsedJob.data.jobId,
        status: 'QUEUED' as const,
        usesOpenAI: false as const,
      });
    },
  });
}
