// @vitest-environment node

import { FakeAIProvider } from '@brq/ai-provider/fake';
import type { CodeGeneratorAgent } from '@brq/code-generator-agent';
import type { ControlledWorkspace } from '@brq/controlled-workspace';
import { FakeKnowledgeSource } from '@brq/knowledge-loader/testing';
import type { SandboxRunner } from '@brq/sandbox-runner';
import { createFactoryTechnicalBoundaryIdentityFixture } from '@brq/factory-pipeline/testing';
import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import {
  createApplicationFactoryRuntime,
  createApplicationRuntime,
  getExecutionEngine,
} from './runtime';

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

  it('composes the full Factory only with explicitly injected execution boundaries in tests', async () => {
    const pipeline = await createApplicationFactoryRuntime({
      aiProvider: new FakeAIProvider(),
      knowledgeSource: new FakeKnowledgeSource(),
      codeGeneratorAgent: {
        execute: async () => Promise.reject(new Error('not executed')),
      } as CodeGeneratorAgent,
      controlledWorkspace: {
        plan: () => {
          throw new Error('not executed');
        },
        materialize: async () => Promise.reject(new Error('not executed')),
        release: async () => Promise.reject(new Error('not executed')),
      } as ControlledWorkspace,
      sandboxRunner: {
        run: async () => Promise.reject(new Error('not executed')),
      } as SandboxRunner,
      technicalBoundaryIdentity: createFactoryTechnicalBoundaryIdentityFixture(),
      environment: { NODE_ENV: 'test' },
      logger: createLogger({ sink: () => undefined }),
      now: () => 0,
    });

    expect(pipeline.execute).toBeTypeOf('function');
    expect(pipeline.resumeTechnical).toBeTypeOf('function');
  });

  it('fails closed when production Factory Docker configuration is absent', async () => {
    await expect(
      createApplicationFactoryRuntime({
        aiProvider: new FakeAIProvider(),
        knowledgeSource: new FakeKnowledgeSource(),
        codeGeneratorAgent: {
          execute: async () => Promise.reject(new Error('not executed')),
        } as CodeGeneratorAgent,
        environment: { NODE_ENV: 'test' },
        logger: createLogger({ sink: () => undefined }),
      }),
    ).rejects.toThrow('configuração Docker explícita');
  });

  it('keeps generative QA outside the critical Factory topology', async () => {
    await expect(
      createApplicationFactoryRuntime({
        qaExecutionMode: 'GENERATIVE',
        aiProvider: new FakeAIProvider(),
        knowledgeSource: new FakeKnowledgeSource(),
        environment: { NODE_ENV: 'test' },
        logger: createLogger({ sink: () => undefined }),
      }),
    ).rejects.toThrow('QA determinístico');
  });
});
