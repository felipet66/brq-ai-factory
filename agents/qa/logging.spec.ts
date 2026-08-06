import type { KnowledgeContext } from '@brq/knowledge-loader';
import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import type { QABusinessValidationResult } from './contracts';
import { QA_AGENT_ERROR_CODES, QAAgentError } from './errors';
import {
  businessValidationLogContext,
  errorLogContext,
  knowledgeLogContext,
  requestLogContext,
  specificationLogContext,
} from './logging';
import { loadQAPromptAssets } from './prompt-assets';
import { createQARequest, createQASpecification } from './testing/qa-fixtures';

const SECRET = 'sk-qa-private-marker-9173';

function allKeys(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...allKeys(nested)]);
}

describe('QA Agent logging', () => {
  it('projeta somente metadata allowlisted das fontes e da especificação', () => {
    const base = createQARequest();
    const request = createQARequest({
      productOwnerSpecification: { ...base.productOwnerSpecification, summary: SECRET },
      technicalSpecification: { ...base.technicalSpecification, summary: SECRET },
    });
    const validation: QABusinessValidationResult = {
      valid: false,
      expectedReadiness: 'READY',
      issues: [{ code: 'QA_UNKNOWN_REFERENCE', path: [SECRET], message: SECRET }],
      issuesTruncated: false,
    };
    const contexts = [
      requestLogContext(request, loadQAPromptAssets()),
      businessValidationLogContext(validation),
      specificationLogContext(createQASpecification()),
    ];
    expect(JSON.stringify(contexts)).not.toContain(SECRET);
    expect(allKeys(contexts)).not.toEqual(
      expect.arrayContaining([
        'productOwnerSpecification',
        'technicalSpecification',
        'content',
        'prompt',
        'response',
        'issues',
        'message',
      ]),
    );
  });

  it('não registra conteúdo do conhecimento', () => {
    const knowledge: KnowledgeContext = {
      context: 'QA',
      manifestVersion: '1.0.0',
      policyVersion: '1.0.0',
      sourceId: 'source',
      content: SECRET,
      contextHash: `sha256:${'a'.repeat(64)}`,
      includedDocuments: [],
      ignoredDocuments: [],
      missingDocuments: [],
      budget: { maxDocuments: 10, maxBytes: 1000, usedDocuments: 0, usedBytes: 0 },
    };
    expect(JSON.stringify(knowledgeLogContext(knowledge))).not.toContain(SECRET);
  });

  it('emite JSON sanitizado sem Error, cause, stack ou source code arbitrário', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });
    const request = createQARequest();
    const error = new QAAgentError('Falha segura.', {
      code: QA_AGENT_ERROR_CODES.RUN_FAILED,
      stage: 'RUNNER_EXECUTION',
      durationMs: 12,
      executionId: request.context.executionId,
      sourceCode: SECRET,
      cause: new Error(SECRET),
    });
    logger.info('qa.agent.started', requestLogContext(request, loadQAPromptAssets()));
    logger.error('qa.agent.failed', errorLogContext(error));

    const serialized = lines.join('\n');
    expect(serialized).toContain(QA_AGENT_ERROR_CODES.RUN_FAILED);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('cause');
    expect(serialized).not.toContain('stack');
    expect(error.sourceCode).toBeUndefined();
  });
});
