// @vitest-environment node

import { FakeAIProvider } from '@brq/ai-provider/fake';
import { FakeKnowledgeSource } from '@brq/knowledge-loader/testing';
import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import { createApplicationRuntime, getExecutionEngine } from './runtime';

describe('application composition root', () => {
  it('creates the Execution Engine using only public component factories', async () => {
    const engine = await createApplicationRuntime({
      aiProvider: new FakeAIProvider(),
      knowledgeSource: new FakeKnowledgeSource(),
      logger: createLogger({ sink: () => undefined }),
      now: () => 0,
    });

    expect(engine.execute).toBeTypeOf('function');
  });

  it('rejects a relative knowledge root before initializing the provider', async () => {
    await expect(
      createApplicationRuntime({
        knowledgeRoot: 'relative/knowledge',
        environment: { NODE_ENV: 'test' },
        logger: createLogger({ sink: () => undefined }),
      }),
    ).rejects.toThrow('raiz');
  });

  it('validates a configured environment root', async () => {
    await expect(
      createApplicationRuntime({
        environment: { NODE_ENV: 'test', BRQ_KNOWLEDGE_ROOT: 'relative/knowledge' },
        logger: createLogger({ sink: () => undefined }),
      }),
    ).rejects.toThrow('absoluto');
  });

  it('memoizes the immutable host dependency graph', async () => {
    const first = getExecutionEngine();
    const second = getExecutionEngine();

    expect(first).toBe(second);
    await expect(first).rejects.toThrow();
  });
});
