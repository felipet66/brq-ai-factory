import { createPromptBuilder, type PromptResult } from '@brq/prompt-builder';
import { createPromptBuildInput } from '@brq/prompt-builder/testing';
import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import { immutableClone } from './immutability';
import { logPromptInspection } from './logging';
import {
  completedInspectionPipeline,
  idleInspectionPipeline,
  projectKnowledgeContext,
  projectPromptSections,
} from './prompt-projection';

function minimalKnowledge(context: 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA') {
  return {
    context,
    manifestVersion: '1.12.0',
    policyVersion: '1.12.0',
    sourceId: 'fixture',
    content: '# Knowledge',
    contextHash: `sha256:${'a'.repeat(64)}`,
    includedDocuments: [],
    ignoredDocuments: [],
    missingDocuments: [],
    budget: { maxDocuments: 24, maxBytes: 65_536, usedDocuments: 0, usedBytes: 11 },
  } as const;
}

describe('Prompt Inspector supporting projections', () => {
  it('projects clean and warning-free pipeline nodes with the real Prompt Builder', () => {
    const logger = createLogger({ sink: () => undefined });
    const promptBuilder = createPromptBuilder({
      configuration: { maxBytes: 64 * 1024 },
      logger,
    });
    const result = promptBuilder.build(createPromptBuildInput());
    const pipeline = completedInspectionPipeline(result, minimalKnowledge('DEVELOPER'));

    expect(idleInspectionPipeline().every((node) => node.status === 'IDLE')).toBe(true);
    expect(pipeline.find((node) => node.stage === 'KNOWLEDGE')?.status).toBe('VALID');
    expect(pipeline.find((node) => node.stage === 'BUDGET')?.status).toBe('VALID');
    expect(projectPromptSections(result)).toHaveLength(result.document.sections.length);

    const warningBudget = {
      ...result,
      budget: {
        ...result.budget,
        maxBytes: result.budget.usedBytes,
      },
    } as PromptResult;
    expect(
      completedInspectionPipeline(warningBudget, minimalKnowledge('DEVELOPER')).find(
        (node) => node.stage === 'BUDGET',
      )?.status,
    ).toBe('WARNING');
  });

  it('projects each supported knowledge context and rejects non-agent contexts', () => {
    expect(projectKnowledgeContext(minimalKnowledge('PRODUCT_OWNER')).context).toBe(
      'PRODUCT_OWNER',
    );
    expect(projectKnowledgeContext(minimalKnowledge('DEVELOPER')).context).toBe('DEVELOPER');
    expect(projectKnowledgeContext(minimalKnowledge('QA')).context).toBe('QA');
    expect(() =>
      projectKnowledgeContext({
        ...minimalKnowledge('QA'),
        context: 'GLOBAL',
      } as never),
    ).toThrow('O contexto não pertence a um agente inspecionável.');
  });

  it('deep-clones and freezes inspection values', () => {
    const source = { nested: { values: [1, 2] } };
    const result = immutableClone(source);

    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    expect(Object.isFrozen(result.nested.values)).toBe(true);
  });

  it('logs only the explicit technical allowlist', () => {
    const lines: string[] = [];
    const logger = createLogger({
      sink: (line) => lines.push(line),
      now: () => new Date('2026-08-07T12:00:00.000Z'),
    });

    logPromptInspection(undefined, 'info', 'ignored', {});
    logPromptInspection(logger, 'info', 'inspection.full', {
      agent: 'DEVELOPER',
      stage: 'CONTRACT',
      status: 'PASS',
      promptHash: 'a'.repeat(64),
      candidateHash: 'b'.repeat(64),
      durationMs: 1,
      errorCode: 'SANITIZED',
    });
    logPromptInspection(logger, 'warn', 'inspection.empty', {});

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      event: 'inspection.full',
      agent: 'DEVELOPER',
      error: { code: 'SANITIZED' },
    });
    expect(JSON.parse(lines[1] ?? '{}')).not.toHaveProperty('agent');
  });
});
