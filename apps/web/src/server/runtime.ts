import path from 'node:path';

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
import {
  createKnowledgeLoader,
  KNOWLEDGE_MANIFEST,
  type KnowledgeSource,
} from '@brq/knowledge-loader';
import { FilesystemKnowledgeSource } from '@brq/knowledge-loader/filesystem';
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

export const AI_FACTORY_PROMPT_BUILDER_MAX_BYTES = 512 * 1024;

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

export interface ApplicationQueueRuntimeOptions {
  readonly engine: ExecutionEngine;
  readonly repository: ExecutionRecordRepository;
  readonly queue?: JobQueue;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export function createApplicationQueueRuntime(
  options: ApplicationQueueRuntimeOptions,
): ApplicationQueueRuntime {
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
  const dispatcher = createExecutionDispatcher({
    queue,
    repository: options.repository,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  worker.start();
  return Object.freeze({ queue, worker, dispatcher });
}

function validateKnowledgeRoot(rootPath: string): string {
  if (!path.isAbsolute(rootPath)) {
    throw new Error('A raiz de knowledge deve ser um caminho absoluto.');
  }
  return rootPath;
}

function defaultKnowledgeRoot(environment: NodeJS.ProcessEnv): string {
  const configured = environment.BRQ_KNOWLEDGE_ROOT?.trim();
  if (configured !== undefined && configured.length > 0) {
    return validateKnowledgeRoot(configured);
  }
  const currentDirectory = process.cwd();
  const fromWebWorkspace =
    path.basename(currentDirectory) === 'web' &&
    path.basename(path.dirname(currentDirectory)) === 'apps';
  return path.resolve(currentDirectory, fromWebWorkspace ? '../../knowledge' : 'knowledge');
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
  const knowledgeRoot = validateKnowledgeRoot(
    options.knowledgeRoot ?? defaultKnowledgeRoot(environment),
  );
  const aiProvider =
    options.aiProvider ?? OpenAIProvider.fromEnvironment(environment, { logger, now });
  const source =
    options.knowledgeSource ??
    new FilesystemKnowledgeSource({
      sourceId: 'knowledge-filesystem',
      rootPath: knowledgeRoot,
      allowedLocators: KNOWLEDGE_MANIFEST.documents.map((document) => document.locator),
    });
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
  queueRuntime: Promise<ApplicationQueueRuntime> | undefined;
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
  return getApplicationQueueRuntime().then((runtime) => runtime.worker);
}

export function getExecutionDispatcher(): Promise<ExecutionDispatcher> {
  return getApplicationQueueRuntime().then((runtime) => runtime.dispatcher);
}

function getApplicationQueueRuntime(): Promise<ApplicationQueueRuntime> {
  runtimeState.queueRuntime ??= Promise.all([getExecutionEngine(), getExecutionRepository()]).then(
    ([engine, repository]) =>
      createApplicationQueueRuntime({
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
    runtimeState.prismaClient ??= createPrismaClient();
    runtimeState.executionRepository = new PrismaExecutionRecordRepository(
      runtimeState.prismaClient,
    );
  }
  return runtimeState.executionRepository;
}

export function getExecutionHistory(): ExecutionHistoryReader {
  return runtimeState.executionHistory;
}
