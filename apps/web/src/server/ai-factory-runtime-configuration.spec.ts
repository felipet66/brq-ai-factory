// @vitest-environment node

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AI_FACTORY_PROMPT_BUILDER_MAX_BYTES,
  createAIFactoryKnowledgeSource,
  resolveAIFactoryKnowledgeRoot,
} from './ai-factory-runtime-configuration';

describe('shared AI Factory host configuration', () => {
  it('keeps the approved multi-agent prompt budget as an explicit host setting', () => {
    expect(AI_FACTORY_PROMPT_BUILDER_MAX_BYTES).toBe(512 * 1024);
  });

  it('uses the explicit knowledge root before environment configuration', () => {
    const explicitRoot = path.resolve('/tmp', 'explicit-knowledge');
    const environmentRoot = path.resolve('/tmp', 'environment-knowledge');

    expect(
      resolveAIFactoryKnowledgeRoot(
        { NODE_ENV: 'test', BRQ_KNOWLEDGE_ROOT: environmentRoot },
        explicitRoot,
      ),
    ).toBe(explicitRoot);
  });

  it('validates configured knowledge roots and preserves the production source identity', () => {
    const root = path.resolve('/tmp', 'knowledge');

    expect(
      resolveAIFactoryKnowledgeRoot({ NODE_ENV: 'test', BRQ_KNOWLEDGE_ROOT: ` ${root} ` }),
    ).toBe(root);
    expect(createAIFactoryKnowledgeSource(root).sourceId).toBe('knowledge-filesystem');
    expect(() =>
      resolveAIFactoryKnowledgeRoot({ NODE_ENV: 'test', BRQ_KNOWLEDGE_ROOT: 'relative' }),
    ).toThrow('A raiz de knowledge deve ser um caminho absoluto.');
  });
});
