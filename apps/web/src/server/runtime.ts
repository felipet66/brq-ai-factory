import path from 'node:path';

import { createAgentRunner } from '@brq/agent-runner';
import type { AIProvider } from '@brq/ai-provider';
import { OpenAIProvider } from '@brq/ai-provider/openai';
import { createArtifactGenerator } from '@brq/artifact-generator';
import { createDeveloperAgent, loadDeveloperPromptAssets } from '@brq/developer-agent';
import { createExecutionEngine, type ExecutionEngine } from '@brq/execution-engine';
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
import { createProductOwnerAgent, loadProductOwnerPromptAssets } from '@brq/product-owner-agent';
import { createPromptBuilder } from '@brq/prompt-builder';
import { createQAAgent, loadQAPromptAssets } from '@brq/qa-agent';
import { createResponseValidator } from '@brq/response-validator';
import { createLogger, type Logger } from '@brq/shared/logger/logger';

export const AI_FACTORY_PROMPT_BUILDER_MAX_BYTES = 512 * 1024;

export interface ApplicationRuntimeOptions {
  readonly aiProvider?: AIProvider;
  readonly environment?: NodeJS.ProcessEnv;
  readonly knowledgeRoot?: string;
  readonly knowledgeSource?: KnowledgeSource;
  readonly executionHistory?: ExecutionHistoryRecorder;
  readonly logger?: Logger;
  readonly now?: () => number;
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
  const executionHistory = options.executionHistory ?? createInMemoryExecutionHistory({ now });
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
  const responseValidator = createResponseValidator({ logger, now });
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
  return createObservedExecutionEngine({ engine, history: executionHistory });
}

interface ApplicationRuntimeState {
  runtime: Promise<ExecutionEngine> | undefined;
  readonly executionHistory: ExecutionHistoryRecorder;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __brqAiFactoryRuntimeState?: ApplicationRuntimeState;
};
const runtimeState = (runtimeGlobal.__brqAiFactoryRuntimeState ??= {
  runtime: undefined,
  executionHistory: createInMemoryExecutionHistory(),
});

export function getExecutionEngine(): Promise<ExecutionEngine> {
  runtimeState.runtime ??= createApplicationRuntime({
    executionHistory: runtimeState.executionHistory,
  });
  return runtimeState.runtime;
}

export function getExecutionHistory(): ExecutionHistoryReader {
  return runtimeState.executionHistory;
}
