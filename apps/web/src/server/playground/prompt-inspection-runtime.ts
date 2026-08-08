import { createKnowledgeLoader, type KnowledgeSource } from '@brq/knowledge-loader';
import { createPromptBuilder } from '@brq/prompt-builder';
import { createPromptInspector, type PromptInspector } from '@brq/prompt-inspector';
import { createResponseValidator } from '@brq/response-validator';
import { createLogger, type Logger } from '@brq/shared/logger/logger';

import {
  AI_FACTORY_PROMPT_BUILDER_MAX_BYTES,
  createAIFactoryKnowledgeSource,
  resolveAIFactoryKnowledgeRoot,
} from '@/server/ai-factory-runtime-configuration';

import { createPlaygroundAgentAdapters } from './adapters';

export interface PlaygroundRuntimeOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly knowledgeRoot?: string;
  readonly knowledgeSource?: KnowledgeSource;
  readonly logger?: Logger;
  readonly now?: () => number;
}

/**
 * Builds the inspection-only runtime. This composition root deliberately has no
 * provider, Agent Runner, execution, persistence or observability dependency.
 */
export async function createPlaygroundRuntime(
  options: PlaygroundRuntimeOptions = {},
): Promise<PromptInspector> {
  const environment = options.environment ?? process.env;
  const logger = options.logger ?? createLogger();
  const componentLogger = createLogger({ sink: () => undefined });
  const source =
    options.knowledgeSource ??
    createAIFactoryKnowledgeSource(
      resolveAIFactoryKnowledgeRoot(environment, options.knowledgeRoot),
    );
  const knowledgeLoader = await createKnowledgeLoader({
    source,
    logger: componentLogger,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const promptBuilder = createPromptBuilder({
    configuration: { maxBytes: AI_FACTORY_PROMPT_BUILDER_MAX_BYTES },
    logger: componentLogger,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const responseValidator = createResponseValidator({
    logger: componentLogger,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  return createPromptInspector({
    knowledgeLoader,
    promptBuilder,
    responseValidator,
    adapters: createPlaygroundAgentAdapters(),
    logger,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

interface PlaygroundRuntimeState {
  runtime: Promise<PromptInspector> | undefined;
}

const playgroundGlobal = globalThis as typeof globalThis & {
  __brqPlaygroundRuntimeState?: PlaygroundRuntimeState;
};

const playgroundRuntimeState = (playgroundGlobal.__brqPlaygroundRuntimeState ??= {
  runtime: undefined,
});

export function getPlaygroundRuntime(): Promise<PromptInspector> {
  playgroundRuntimeState.runtime ??= createPlaygroundRuntime();
  return playgroundRuntimeState.runtime;
}
