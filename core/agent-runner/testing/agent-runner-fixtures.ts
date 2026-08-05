import type { AIProvider } from '@brq/ai-provider';
import { createPromptBuilder, type PromptBuilder } from '@brq/prompt-builder';
import { createLogger, type Logger } from '@brq/shared/logger/logger';

import type { AgentRunRequest, CreateAgentRunnerOptions, PromptRequest } from '../contracts';

function createPromptRequest(): PromptRequest {
  return {
    template: {
      id: 'prompt:agent-runner-fixture',
      agent: 'DEVELOPER',
      version: '1.0.0',
      schemaVersion: '1.0.0',
      sections: [
        {
          id: 'agent-rules',
          kind: 'AGENT_RULES',
          channel: 'INSTRUCTIONS',
          trust: 'TRUSTED',
          blocks: [
            {
              id: 'agent-rules:block',
              kind: 'RULES',
              fragments: [
                {
                  id: 'agent-rules:slot',
                  type: 'RULE_SET_SLOT',
                  ruleSetId: 'rules:developer',
                },
              ],
            },
          ],
        },
        {
          id: 'user-input',
          kind: 'USER_INPUT',
          channel: 'INPUT',
          trust: 'UNTRUSTED',
          blocks: [
            {
              id: 'user-input:block',
              kind: 'CONTENT',
              fragments: [
                {
                  id: 'user-input:slot',
                  type: 'VARIABLE_SLOT',
                  name: 'USER_INPUT',
                  serialization: 'TEXT',
                },
              ],
            },
          ],
        },
        {
          id: 'output-contract',
          kind: 'OUTPUT_CONTRACT',
          channel: 'INSTRUCTIONS',
          trust: 'TRUSTED',
          blocks: [
            {
              id: 'output-contract:block',
              kind: 'OUTPUT_CONTRACT',
              fragments: [{ id: 'output-contract:slot', type: 'OUTPUT_CONTRACT_SLOT' }],
            },
          ],
        },
      ],
    },
    ruleSets: [
      {
        id: 'rules:developer',
        version: '1.0.0',
        scope: 'AGENT',
        agent: 'DEVELOPER',
        rules: [{ id: 'developer:scope', content: 'Implemente apenas o escopo solicitado.' }],
      },
    ],
    contexts: [],
    variables: [{ name: 'USER_INPUT', value: 'Crie um módulo pequeno e testável.' }],
    constraints: [],
    outputContract: {
      id: 'contract:developer-output',
      version: '1.0.0',
      format: 'JSON_SCHEMA',
      instructions: ['Retorne um objeto JSON que respeite o schema.'],
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary'],
        properties: { summary: { type: 'string' } },
      },
    },
  };
}

export function createAgentRunRequest(): AgentRunRequest {
  const prompt = createPromptRequest();

  return {
    context: {
      execution: {
        executionId: 'execution-1',
        agentExecutionId: 'agent-execution-1',
        agent: prompt.template.agent,
        attempt: 1,
        agentVersion: '1.0.0',
      },
      requestId: 'request-1',
      traceId: 'trace-1',
    },
    prompt: {
      template: prompt.template,
      ruleSets: prompt.ruleSets,
      contexts: prompt.contexts,
      variables: prompt.variables,
      constraints: prompt.constraints,
      outputContract: prompt.outputContract,
    },
    model: 'test-model',
    maxOutputTokens: 512,
    timeoutMs: 30_000,
  };
}

export function quietLogger(lines: string[] = []): Logger {
  return createLogger({
    sink: (line) => lines.push(line),
    now: () => new Date('2026-08-05T12:00:00.000Z'),
  });
}

export function deterministicNow(step = 10): () => number {
  let current = 0;
  return () => {
    const value = current;
    current += step;
    return value;
  };
}

export function runnerDependencies(
  aiProvider: AIProvider,
  overrides: Partial<CreateAgentRunnerOptions> = {},
): CreateAgentRunnerOptions {
  const promptBuilder: PromptBuilder = createPromptBuilder({ logger: quietLogger() });

  return {
    aiProvider,
    promptBuilder,
    logger: quietLogger(),
    now: deterministicNow(),
    ...overrides,
  };
}
