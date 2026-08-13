import { createAgentRunner } from '@brq/agent-runner';
import { createCachedAIProvider, type AIProvider, type AIResponseCache } from '@brq/ai-provider';
import { OpenAIProvider } from '@brq/ai-provider/openai';
import { createArtifactGenerator } from '@brq/artifact-generator';
import {
  createCodeGeneratorAgent,
  loadCodeGeneratorPromptAssets,
  type CodeGeneratorAgent,
} from '@brq/code-generator-agent';
import type { ControlledWorkspace } from '@brq/controlled-workspace';
import { createFilesystemControlledWorkspace } from '@brq/controlled-workspace/filesystem';
import { createDeveloperAgent, loadDeveloperPromptAssets } from '@brq/developer-agent';
import { createExecutionEngine, type ExecutionEngine } from '@brq/execution-engine';
import {
  createPersistentFactoryPipeline,
  createInMemoryExecutionRecordRepository,
  createPersistentExecutionEngine,
  createRepositoryBackedFactoryExecutionHistory,
  createRepositoryBackedExecutionHistory,
  PrismaExecutionRequestSnapshotRepository,
  terminalExecutionRecordStatusSchema,
  type ExecutionRecordRepository,
  type FactoryExecutionRecordRepository,
} from '@brq/execution-repository';
import { PrismaExecutionRecordRepository } from '@brq/execution-repository/prisma';
import {
  createExecutionDispatcher,
  createCacheOnlyExecutionDispatcher,
  createExecutionRerunDispatcher,
  createSnapshottingExecutionDispatcher,
  createExecutionWorker,
  type ExecutionDispatcher,
  type ExecutionRerunDispatcher,
  type ExecutionWorker,
} from '@brq/execution-worker';
import {
  createFactoryPipelineCoordinator,
  type FactoryPipelineConfiguration,
  type FactoryPipelineCoordinator,
} from '@brq/factory-pipeline';
import { createKnowledgeLoader, type KnowledgeSource } from '@brq/knowledge-loader';
import {
  createInMemoryExecutionHistory,
  createInMemoryFactoryExecutionHistory,
  createObservabilityLogger,
  createObservedExecutionEngine,
  createObservedFactoryPipeline,
  type ExecutionHistoryReader,
  type ExecutionHistoryRecorder,
  type FactoryExecutionHistoryRecorder,
} from '@brq/observability';
import { createOrchestrator } from '@brq/orchestrator';
import { createInMemoryJobQueue, type JobQueue } from '@brq/job-queue';
import { createProductOwnerAgent, loadProductOwnerPromptAssets } from '@brq/product-owner-agent';
import { createPromptBuilder } from '@brq/prompt-builder';
import { createDeterministicQAAgent, createQAAgent, loadQAPromptAssets } from '@brq/qa-agent';
import { createResponseValidator } from '@brq/response-validator';
import { createDevelopmentResponseValidator } from '@brq/response-validator/development';
import type { SandboxRunner } from '@brq/sandbox-runner';
import {
  createDockerArtifactCapturingSandboxRunner,
  createDockerSandboxRunner,
} from '@brq/sandbox-runner/docker';
import { createPrismaClient, PrismaAIResponseCache, type DatabaseClient } from '@brq/prisma';
import { createLogger, type Logger } from '@brq/shared/logger/logger';

import type { AuthenticatedPrincipal } from './auth/contracts';
import {
  AI_FACTORY_PROMPT_BUILDER_MAX_BYTES,
  createAIFactoryKnowledgeSource,
  resolveAIFactoryKnowledgeRoot,
} from './ai-factory-runtime-configuration';
import {
  FACTORY_PIPELINE_CONFIGURATION,
  FACTORY_SANDBOX_POLICY_ID,
  resolveFactorySandboxRuntimeConfiguration,
} from './factory-sandbox-runtime-configuration';
import type { FactoryPreviewArtifactIntegration } from './preview/artifact-integration';
import type { PreviewApplicationService } from './preview/contracts';
import type { PreviewGatewayService } from './preview/gateway-contracts';
import {
  createApplicationFactoryPreviewArtifactIntegration,
  createApplicationPreviewRuntime,
  type ApplicationPreviewRuntime,
} from './preview/runtime';

export interface ApplicationRuntimeOptions {
  readonly aiProvider?: AIProvider;
  readonly aiResponseCache?: AIResponseCache;
  readonly qaExecutionMode?: 'DETERMINISTIC' | 'GENERATIVE';
  readonly environment?: NodeJS.ProcessEnv;
  readonly knowledgeRoot?: string;
  readonly knowledgeSource?: KnowledgeSource;
  readonly executionHistory?: ExecutionHistoryRecorder;
  readonly executionRepository?: ExecutionRecordRepository;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface ApplicationFactoryRuntimeOptions extends Omit<
  ApplicationRuntimeOptions,
  'executionRepository'
> {
  readonly executionRepository?: FactoryExecutionRecordRepository;
  readonly factoryExecutionHistory?: FactoryExecutionHistoryRecorder;
  readonly codeGeneratorAgent?: CodeGeneratorAgent;
  readonly controlledWorkspace?: ControlledWorkspace;
  readonly sandboxRunner?: SandboxRunner;
  readonly factoryConfiguration?: FactoryPipelineConfiguration;
  readonly previewArtifactIntegration?: FactoryPreviewArtifactIntegration;
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

interface ApplicationQueueRuntimeBaseOptions {
  readonly repository: ExecutionRecordRepository;
  readonly queue?: JobQueue;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export type ApplicationQueueRuntimeOptions = ApplicationQueueRuntimeBaseOptions &
  (
    | { readonly engine: ExecutionEngine; readonly pipeline?: never }
    | { readonly pipeline: FactoryPipelineCoordinator; readonly engine?: never }
  );

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
    ...('pipeline' in options ? { pipeline: options.pipeline } : { engine: options.engine }),
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

async function composeExecutionCore(
  options: ApplicationRuntimeOptions,
  logger: Logger,
  baseLogger: Logger,
  now: () => number,
) {
  const environment = options.environment ?? process.env;
  const knowledgeRoot = resolveAIFactoryKnowledgeRoot(environment, options.knowledgeRoot);
  const baseAIProvider =
    options.aiProvider ?? OpenAIProvider.fromEnvironment(environment, { logger, now });
  const aiProvider =
    options.aiResponseCache === undefined
      ? baseAIProvider
      : createCachedAIProvider({
          provider: baseAIProvider,
          cache: options.aiResponseCache,
          logger,
        });
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
  const qaPromptAssets = loadQAPromptAssets();
  const qaAgent =
    options.qaExecutionMode === 'GENERATIVE'
      ? createQAAgent({
          knowledgeLoader,
          agentRunner,
          responseValidator,
          artifactGenerator,
          promptAssets: qaPromptAssets,
          logger,
          now,
        })
      : createDeterministicQAAgent({
          knowledgeLoader,
          promptBuilder,
          responseValidator,
          artifactGenerator,
          promptAssets: qaPromptAssets,
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
  return Object.freeze({
    engine: createExecutionEngine({ orchestrator, logger, now }),
    knowledgeLoader,
    agentRunner,
    responseValidator,
  });
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
  const { engine } = await composeExecutionCore(options, logger, baseLogger, now);
  const observedEngine = createObservedExecutionEngine({ engine, history: executionHistory });
  return createPersistentExecutionEngine({
    engine: observedEngine,
    repository,
    history: executionHistory,
    logger: baseLogger,
    now,
  });
}

function resolveFactoryBoundaries(
  options: ApplicationFactoryRuntimeOptions,
  logger: Logger,
  now: () => number,
): { readonly workspace: ControlledWorkspace; readonly sandboxRunner: SandboxRunner } {
  const hasWorkspace = options.controlledWorkspace !== undefined;
  const hasSandbox = options.sandboxRunner !== undefined;
  if (hasWorkspace !== hasSandbox) {
    throw new TypeError(
      'Controlled Workspace e Sandbox Runner devem ser injetados juntos na composição da Factory.',
    );
  }
  if (options.controlledWorkspace !== undefined && options.sandboxRunner !== undefined) {
    return Object.freeze({
      workspace: options.controlledWorkspace,
      sandboxRunner: options.sandboxRunner,
    });
  }

  const configuration = resolveFactorySandboxRuntimeConfiguration(
    options.environment ?? process.env,
  );
  return Object.freeze({
    workspace: createFilesystemControlledWorkspace({
      rootPath: configuration.workspaceRoot,
      logger,
      now,
    }),
    sandboxRunner:
      options.previewArtifactIntegration === undefined
        ? createDockerSandboxRunner({
            workspaceRoot: configuration.workspaceRoot,
            dockerExecutable: configuration.dockerExecutable,
            dockerHost: configuration.dockerHost,
            image: configuration.image,
            policies: Object.freeze([configuration.policy]),
            logger,
            now,
          })
        : createDockerArtifactCapturingSandboxRunner(
            {
              workspaceRoot: configuration.workspaceRoot,
              dockerExecutable: configuration.dockerExecutable,
              dockerHost: configuration.dockerHost,
              image: configuration.image,
              policies: Object.freeze([configuration.policy]),
              logger,
              now,
            },
            options.previewArtifactIntegration.artifactSink,
          ),
  });
}

export async function createApplicationFactoryRuntime(
  options: ApplicationFactoryRuntimeOptions = {},
): Promise<FactoryPipelineCoordinator> {
  if (options.qaExecutionMode === 'GENERATIVE') {
    throw new TypeError(
      'A Factory crítica exige QA determinístico; QA generativo é somente consultivo.',
    );
  }
  const now = options.now ?? Date.now;
  const baseLogger = options.logger ?? createLogger();
  const repository = options.executionRepository ?? createInMemoryExecutionRecordRepository();
  const memoryHistory =
    options.factoryExecutionHistory ?? createInMemoryFactoryExecutionHistory({ now });
  const executionHistory = createRepositoryBackedFactoryExecutionHistory({
    history: memoryHistory,
    repository,
    logger: baseLogger,
  });
  const logger = createObservabilityLogger({ delegate: baseLogger, history: executionHistory });
  const core = await composeExecutionCore(options, logger, baseLogger, now);
  const codeGeneratorAgent =
    options.codeGeneratorAgent ??
    createCodeGeneratorAgent({
      knowledgeLoader: core.knowledgeLoader,
      agentRunner: core.agentRunner,
      responseValidator: core.responseValidator,
      promptAssets: loadCodeGeneratorPromptAssets(),
      logger,
      now,
    });
  const boundaries = resolveFactoryBoundaries(options, logger, now);
  const coordinator = createFactoryPipelineCoordinator({
    executionEngine: core.engine,
    codeGeneratorAgent,
    workspace: boundaries.workspace,
    sandboxRunner: boundaries.sandboxRunner,
    configuration: options.factoryConfiguration ?? FACTORY_PIPELINE_CONFIGURATION,
    logger,
    now,
  });
  const observedPipeline = createObservedFactoryPipeline({
    pipeline: coordinator,
    history: executionHistory,
  });
  const persistentPipeline = createPersistentFactoryPipeline({
    pipeline: observedPipeline,
    repository,
    history: executionHistory,
    logger: baseLogger,
    now,
  });
  return options.previewArtifactIntegration?.decorate(persistentPipeline) ?? persistentPipeline;
}

interface ApplicationRuntimeState {
  runtime: Promise<ExecutionEngine> | undefined;
  factoryRuntime: Promise<FactoryPipelineCoordinator> | undefined;
  queueRuntime: Promise<ApplicationWorkerRuntime> | undefined;
  readonly executionHistory: ExecutionHistoryRecorder;
  readonly factoryExecutionHistory: FactoryExecutionHistoryRecorder;
  readonly logger: Logger;
  executionRepository: FactoryExecutionRecordRepository | undefined;
  jobQueue: JobQueue | undefined;
  prismaClient: DatabaseClient | undefined;
  previewRuntime: Promise<ApplicationPreviewRuntime> | undefined;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __brqAiFactoryRuntimeState?: ApplicationRuntimeState;
};
const runtimeState = (runtimeGlobal.__brqAiFactoryRuntimeState ??= {
  runtime: undefined,
  factoryRuntime: undefined,
  queueRuntime: undefined,
  executionHistory: createInMemoryExecutionHistory(),
  factoryExecutionHistory: createInMemoryFactoryExecutionHistory(),
  logger: createLogger(),
  executionRepository: undefined,
  jobQueue: undefined,
  prismaClient: undefined,
  previewRuntime: undefined,
});

export function getExecutionEngine(): Promise<ExecutionEngine> {
  runtimeState.runtime ??= getExecutionRepository().then((executionRepository) =>
    createApplicationRuntime({
      aiResponseCache: new PrismaAIResponseCache(getDatabaseClient()),
      executionHistory: runtimeState.executionHistory,
      executionRepository,
      logger: runtimeState.logger,
    }),
  );
  return runtimeState.runtime;
}

export function getFactoryPipeline(): Promise<FactoryPipelineCoordinator> {
  runtimeState.factoryRuntime ??= getExecutionRepository().then((executionRepository) =>
    createApplicationFactoryRuntime({
      aiResponseCache: new PrismaAIResponseCache(getDatabaseClient()),
      factoryExecutionHistory: runtimeState.factoryExecutionHistory,
      executionRepository,
      logger: runtimeState.logger,
      previewArtifactIntegration: createApplicationFactoryPreviewArtifactIntegration({
        client: getDatabaseClient(),
        environment: process.env,
        sandboxPolicyId: FACTORY_SANDBOX_POLICY_ID,
      }),
    }),
  );
  return runtimeState.factoryRuntime;
}

function getApplicationPreviewRuntime(): Promise<ApplicationPreviewRuntime> {
  runtimeState.previewRuntime ??= createApplicationPreviewRuntime({
    client: getDatabaseClient(),
    environment: process.env,
    logger: runtimeState.logger,
  });
  return runtimeState.previewRuntime;
}

export function getPreviewApplicationService(): Promise<PreviewApplicationService> {
  return getApplicationPreviewRuntime().then((runtime) => runtime.applicationService);
}

export function getPreviewGatewayService(): Promise<PreviewGatewayService> {
  return getApplicationPreviewRuntime().then((runtime) => runtime.gatewayService);
}

export function getPreviewOriginTemplate(): string {
  const template = process.env.BRQ_PREVIEW_ORIGIN_TEMPLATE;
  if (template === undefined) throw new TypeError('A origin de Preview não está configurada.');
  return template;
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

export async function getExecutionRerunDispatcherForPrincipal(
  principal: AuthenticatedPrincipal,
): Promise<ExecutionRerunDispatcher> {
  await getApplicationWorkerRuntime();
  const repository = new PrismaExecutionRecordRepository(getDatabaseClient(), {
    access: 'OWNER',
    userId: principal.userId,
  });
  const queueDispatcher = createExecutionDispatcher({
    queue: getJobQueue(),
    repository,
    logger: runtimeState.logger,
  });
  return createExecutionRerunDispatcher({
    snapshots: new PrismaExecutionRequestSnapshotRepository(getDatabaseClient(), principal.userId),
    sourceEligibility: {
      async inspectExecution(executionId) {
        const source = await repository.findByExecutionId(executionId);
        if (source === null) return null;
        return Object.freeze({
          executionId,
          terminal: terminalExecutionRecordStatusSchema.safeParse(source.status).success,
          codeGeneratorSucceeded:
            source.factoryResult?.stages.some(
              (stage) => stage.stageId === 'CODE_GENERATOR' && stage.status === 'SUCCESS',
            ) === true,
        });
      },
    },
    checkpoints: new PrismaAIResponseCache(getDatabaseClient()),
    cacheOnlyDispatcher: createCacheOnlyExecutionDispatcher(queueDispatcher),
  });
}

export function createPrincipalExecutionDispatcher(
  options: PrincipalExecutionDispatcherOptions,
): ExecutionDispatcher {
  const repository = new PrismaExecutionRecordRepository(options.client, {
    access: 'OWNER',
    userId: options.principal.userId,
  });
  const dispatcher = createExecutionDispatcher({
    queue: options.queue,
    repository,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return createSnapshottingExecutionDispatcher({
    dispatcher,
    snapshots: new PrismaExecutionRequestSnapshotRepository(
      options.client,
      options.principal.userId,
    ),
    ownerId: options.principal.userId,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

function getApplicationWorkerRuntime(): Promise<ApplicationWorkerRuntime> {
  runtimeState.queueRuntime ??= Promise.all([getFactoryPipeline(), getExecutionRepository()]).then(
    ([pipeline, repository]) =>
      createApplicationWorkerRuntime({
        pipeline,
        repository,
        queue: getJobQueue(),
        logger: runtimeState.logger,
      }),
  );
  return runtimeState.queueRuntime;
}

export async function getExecutionRepository(): Promise<FactoryExecutionRecordRepository> {
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
