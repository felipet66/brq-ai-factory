import type { QAAgent } from './contracts';
import type { CreateDeterministicQAAgentOptions } from './contracts';
import { createDeterministicQAAgentRunner } from './deterministic-agent-runner';
import { createQAAgent } from './qa-agent';

export function createDeterministicQAAgent(options: CreateDeterministicQAAgentOptions): QAAgent {
  return createQAAgent({
    knowledgeLoader: options.knowledgeLoader,
    agentRunner: createDeterministicQAAgentRunner({
      promptBuilder: options.promptBuilder,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      ...(options.now === undefined ? {} : { now: options.now }),
    }),
    responseValidator: options.responseValidator,
    artifactGenerator: options.artifactGenerator,
    promptAssets: options.promptAssets,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}
