import { createAgentRunner } from '@brq/agent-runner';
import type { AIProvider } from '@brq/ai-provider';
import { OpenAIProvider } from '@brq/ai-provider/openai';
import { createArtifactGenerator } from '@brq/artifact-generator';
import { createDeveloperAgent, loadDeveloperPromptAssets } from '@brq/developer-agent';
import { createExecutionEngine, type ExecutionEngine } from '@brq/execution-engine';
import {
  createInMemoryExecutionRecordRepository,
  createPersistentExecutionEngine,
  createRepositoryBackedExecutionHistory,
  type ExecutionRecordRepository,
} from '@brq/execution-repository';
import { PrismaExecutionRecordRepository } from '@brq/execution-repository/prisma';
import {
  createExecutionDispatcher,
  createExecutionWorker,
  type ExecutionDispatcher,
  type ExecutionWorker,
} from '@brq/execution-worker';
import { createKnowledgeLoader, type KnowledgeSource } from '@brq/knowledge-loader';
import {
  createInMemoryExecutionHistory,
  createObservabilityLogger,
  createObservedExecutionEngine,
  type ExecutionHistoryReader,
  type ExecutionHistoryRecorder,
} from '@brq/observability';
import { createOrchestrator } from '@brq/orchestrator';
import { createInMemoryJobQueue, type JobQueue } from '@brq/job-queue';
import { createProductOwnerAgent, loadProductOwnerPromptAssets } from '@brq/product-owner-agent';
import { createPromptBuilder } from '@brq/prompt-builder';
import { createQAAgent, loadQAPromptAssets } from '@brq/qa-agent';
import { createResponseValidator } from '@brq/response-validator';
import { createDevelopmentResponseValidator } from '@brq/response-validator/development';
import { createPrismaClient, type DatabaseClient } from '@brq/prisma';
import { createLogger, type Logger } from '@brq/shared/logger/logger';

import type { AuthenticatedPrincipal } from './auth/contracts';
import {
  AI_FACTORY_PROMPT_BUILDER_MAX_BYTES,
  createAIFactoryKnowledgeSource,
  resolveAIFactoryKnowledgeRoot,
} from './ai-factory-runtime-configuration';

export interface ApplicationRuntimeOptions {
  readonly aiProvider?: AIProvider;
  readonly environment?: NodeJS.ProcessEnv;
  readonly knowledgeRoot?: string;
  readonly knowledgeSource?: KnowledgeSource;
  readonly executionHistory?: ExecutionHistoryRecorder;
  readonly executionRepository?: ExecutionRecordRepository;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface ApplicationQueueRuntime {
  readonly queue: JobQueue;
  readonly worker: ExecutionWorker;
  readonly dispatcher: ExecutionDispatcher;
}

export interface ApplicationWorkerRuntime {
  readonly queue: JobQueue;
  readonly worker: ExecutionWorker;
}

export interface ApplicationQueueRuntimeOptions {
  readonly engine: ExecutionEngine;
  readonly repository: ExecutionRecordRepository;
  readonly queue?: JobQueue;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface PrincipalExecutionDispatcherOptions {
  readonly principal: AuthenticatedPrincipal;
  readonly client: DatabaseClient;
  readonly queue: JobQueue;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export function createApplicationQueueRuntime(
  options: ApplicationQueueRuntimeOptions,
): ApplicationQueueRuntime {
  const runtime = composeApplicationWorkerRuntime(options);
  const dispatcher = createExecutionDispatcher({
    queue: runtime.queue,
    repository: options.repository,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  runtime.worker.start();
  return Object.freeze({ ...runtime, dispatcher });
}

function composeApplicationWorkerRuntime(
  options: ApplicationQueueRuntimeOptions,
): ApplicationWorkerRuntime {
  const queue =
    options.queue ??
    createInMemoryJobQueue({
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  const worker = createExecutionWorker({
    queue,
    engine: options.engine,
    repository: options.repository,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  return Object.freeze({ queue, worker });
}

export function createApplicationWorkerRuntime(
  options: ApplicationQueueRuntimeOptions,
): ApplicationWorkerRuntime {
  const runtime = composeApplicationWorkerRuntime(options);
  runtime.worker.start();
  return runtime;
}

export async function createApplicationRuntime(
  options: ApplicationRuntimeOptions = {},
): Promise<ExecutionEngine> {
  const now = options.now ?? Date.now;
  const baseLogger = options.logger ?? createLogger();
  const repository = options.executionRepository ?? createInMemoryExecutionRecordRepository();
  const memoryHistory = options.executionHistory ?? createInMemoryExecutionHistory({ now });
  const executionHistory = createRepositoryBackedExecutionHistory({
    history: memoryHistory,
    repository,
    logger: baseLogger,
  });
  const logger = createObservabilityLogger({ delegate: baseLogger, history: executionHistory });
  const environment = options.environment ?? process.env;
  const knowledgeRoot = resolveAIFactoryKnowledgeRoot(environment, options.knowledgeRoot);
  const aiProvider =
    options.aiProvider ?? OpenAIProvider.fromEnvironment(environment, { logger, now });
  const source = options.knowledgeSource ?? createAIFactoryKnowledgeSource(knowledgeRoot);
  const knowledgeLoader = await createKnowledgeLoader({ source, logger, now });
  const promptBuilder = createPromptBuilder({
    configuration: { maxBytes: AI_FACTORY_PROMPT_BUILDER_MAX_BYTES },
    logger,
    now,
  });
  const agentRunner = createAgentRunner({ promptBuilder, aiProvider, logger, now });
  const responseValidator =
    environment.NODE_ENV === 'development'
      ? createDevelopmentResponseValidator({
          environment,
          logger,
          now,
          reporter: (report) => {
            baseLogger.debug('response.validation.structured_output_debug', { ...report });
          },
        })
      : createResponseValidator({ logger, now });
  const artifactGenerator = createArtifactGenerator({ logger, now });

  const productOwnerAgent = createProductOwnerAgent({
    knowledgeLoader,
    agentRunner,
    responseValidator,
    artifactGenerator,
    promptAssets: loadProductOwnerPromptAssets(),
    logger,
    now,
  });
  const developerAgent = createDeveloperAgent({
    knowledgeLoader,
    agentRunner,
    responseValidator,
    artifactGenerator,
    promptAssets: loadDeveloperPromptAssets(),
    logger,
    now,
  });
  const qaAgent = createQAAgent({
    knowledgeLoader,
    agentRunner,
    responseValidator,
    artifactGenerator,
    promptAssets: loadQAPromptAssets(),
    logger,
    now,
  });
  const orchestrator = createOrchestrator({
    productOwnerAgent,
    developerAgent,
    qaAgent,
    logger,
    now,
  });
  const engine = createExecutionEngine({ orchestrator, logger, now });
  const observedEngine = createObservedExecutionEngine({ engine, history: executionHistory });
  return createPersistentExecutionEngine({
    engine: observedEngine,
    repository,
    history: executionHistory,
    logger: baseLogger,
    now,
  });
}

interface ApplicationRuntimeState {
  runtime: Promise<ExecutionEngine> | undefined;
  queueRuntime: Promise<ApplicationWorkerRuntime> | undefined;
  readonly executionHistory: ExecutionHistoryRecorder;
  readonly logger: Logger;
  executionRepository: ExecutionRecordRepository | undefined;
  jobQueue: JobQueue | undefined;
  prismaClient: DatabaseClient | undefined;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __brqAiFactoryRuntimeState?: ApplicationRuntimeState;
};
const runtimeState = (runtimeGlobal.__brqAiFactoryRuntimeState ??= {
  runtime: undefined,
  queueRuntime: undefined,
  executionHistory: createInMemoryExecutionHistory(),
  logger: createLogger(),
  executionRepository: undefined,
  jobQueue: undefined,
  prismaClient: undefined,
});

export function getExecutionEngine(): Promise<ExecutionEngine> {
  runtimeState.runtime ??= getExecutionRepository().then((executionRepository) =>
    createApplicationRuntime({
      executionHistory: runtimeState.executionHistory,
      executionRepository,
      logger: runtimeState.logger,
    }),
  );
  return runtimeState.runtime;
}

export function getJobQueue(): JobQueue {
  runtimeState.jobQueue ??= createInMemoryJobQueue({ logger: runtimeState.logger });
  return runtimeState.jobQueue;
}

export function getExecutionWorker(): Promise<ExecutionWorker> {
  return getApplicationWorkerRuntime().then((runtime) => runtime.worker);
}

export async function getExecutionDispatcherForPrincipal(
  principal: AuthenticatedPrincipal,
): Promise<ExecutionDispatcher> {
  await getApplicationWorkerRuntime();
  return createPrincipalExecutionDispatcher({
    principal,
    client: getDatabaseClient(),
    queue: getJobQueue(),
    logger: runtimeState.logger,
  });
}

export function createPrincipalExecutionDispatcher(
  options: PrincipalExecutionDispatcherOptions,
): ExecutionDispatcher {
  const repository = new PrismaExecutionRecordRepository(options.client, {
    access: 'OWNER',
    userId: options.principal.userId,
  });
  return createExecutionDispatcher({
    queue: options.queue,
    repository,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

function getApplicationWorkerRuntime(): Promise<ApplicationWorkerRuntime> {
  runtimeState.queueRuntime ??= Promise.all([getExecutionEngine(), getExecutionRepository()]).then(
    ([engine, repository]) =>
      createApplicationWorkerRuntime({
        engine,
        repository,
        queue: getJobQueue(),
        logger: runtimeState.logger,
      }),
  );
  return runtimeState.queueRuntime;
}

export async function getExecutionRepository(): Promise<ExecutionRecordRepository> {
  if (runtimeState.executionRepository === undefined) {
    runtimeState.executionRepository = new PrismaExecutionRecordRepository(getDatabaseClient(), {
      access: 'INTERNAL',
    });
  }
  return runtimeState.executionRepository;
}

export function getDatabaseClient(): DatabaseClient {
  runtimeState.prismaClient ??= createPrismaClient();
  return runtimeState.prismaClient;
}

export async function getExecutionRepositoryForRead(
  principal: AuthenticatedPrincipal,
): Promise<ExecutionRecordRepository> {
  return createPrincipalExecutionRepositoryForRead(getDatabaseClient(), principal);
}

export function createPrincipalExecutionRepositoryForRead(
  client: DatabaseClient,
  principal: AuthenticatedPrincipal,
): ExecutionRecordRepository {
  return new PrismaExecutionRecordRepository(
    client,
    principal.role === 'ADMIN'
      ? { access: 'GLOBAL_READ_ONLY' }
      : { access: 'OWNER', userId: principal.userId },
  );
}

export function getExecutionHistory(): ExecutionHistoryReader {
  return runtimeState.executionHistory;
}
