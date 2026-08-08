import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import type { KnowledgeContext, KnowledgeLoader } from '@brq/knowledge-loader';
import {
  canonicalizeJson,
  calculatePromptHash,
  createPromptBuilder,
  type PromptBuildInput,
} from '@brq/prompt-builder';
import { createPromptBuildInput } from '@brq/prompt-builder/testing';
import { createResponseValidator } from '@brq/response-validator';
import { createLogger } from '@brq/shared/logger/logger';
import type { JsonValue } from '@brq/shared/types/json-value';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import type { PromptInspectorAgentAdapter } from './contracts';
import { PROMPT_INSPECTOR_ERROR_CODES, PromptInspectorError } from './errors';
import { PROMPT_INSPECTOR_MAX_ISSUES } from './limits';
import { createPromptInspector } from './prompt-inspector';

const KNOWLEDGE_CONTENT = '# Architecture\nInspection-only knowledge.';
const KNOWLEDGE_HASH = `sha256:${createHash('sha256').update(KNOWLEDGE_CONTENT).digest('hex')}`;
const KNOWLEDGE_CONTEXT: KnowledgeContext = {
  context: 'DEVELOPER',
  manifestVersion: '1.12.0',
  policyVersion: '1.12.0',
  sourceId: 'inspection-fixture',
  content: KNOWLEDGE_CONTENT,
  contextHash: KNOWLEDGE_HASH,
  includedDocuments: [
    {
      id: 'knowledge:architecture',
      title: 'Architecture',
      origin: { sourceId: 'inspection-fixture', locator: '03-ARCHITECTURE.md' },
      category: 'ARCHITECTURE',
      order: 3,
      hash: KNOWLEDGE_HASH,
      sizeBytes: Buffer.byteLength(KNOWLEDGE_CONTENT, 'utf8'),
    },
  ],
  ignoredDocuments: [
    {
      id: 'knowledge:system-design',
      locator: '08-SYSTEM_DESIGN.md',
      reason: 'BUDGET_EXCEEDED',
    },
  ],
  missingDocuments: [{ id: 'adr:001', locator: 'ADR/ADR-001-FOUNDATION.md', required: false }],
  budget: {
    maxDocuments: 24,
    maxBytes: 64 * 1024,
    usedDocuments: 1,
    usedBytes: Buffer.byteLength(KNOWLEDGE_CONTENT, 'utf8'),
  },
};

function knowledgeLoader(
  load: KnowledgeLoader['load'] = async () => KNOWLEDGE_CONTEXT,
): KnowledgeLoader {
  return {
    getIndex: () => {
      throw new Error('The inspector does not read the knowledge index directly.');
    },
    load,
  };
}

function promptInput(context: KnowledgeContext): PromptBuildInput {
  const input = createPromptBuildInput();
  return {
    ...input,
    contexts: input.contexts.map((item) =>
      item.kind === 'KNOWLEDGE'
        ? {
            ...item,
            content: context.content,
            contentHash: context.contextHash,
            references: context.includedDocuments.map((document) => ({
              id: document.id,
              category: document.category,
              hash: document.hash,
            })),
          }
        : item,
    ),
  };
}

function adapter(
  overrides: Partial<PromptInspectorAgentAdapter> = {},
): PromptInspectorAgentAdapter {
  const outputContract = createPromptBuildInput().outputContract;
  const outputContractHash = calculatePromptHash(
    canonicalizeJson(outputContract as unknown as JsonValue),
  );
  return {
    agent: 'DEVELOPER',
    label: 'Developer',
    description: 'Inspect the technical specification prompt.',
    inputKind: 'PRODUCT_OWNER_SPECIFICATION',
    versions: {
      agentVersion: '1.0.0',
      promptVersion: '1.0.0',
      promptSchemaVersion: '1.0.0',
      outputContractVersion: '1.0.0',
    },
    activeBundleHash: 'b'.repeat(64),
    examples: [
      {
        id: 'example:developer',
        label: 'Small service',
        description: 'A synthetic, versioned inspection example.',
        input: { summary: 'Inspect this handoff.' },
        candidate: JSON.stringify({ summary: 'valid' }),
      },
    ],
    knowledgeContext: 'DEVELOPER',
    validationContract: {
      id: outputContract.id,
      version: outputContract.version,
      expectedOutputContractHash: outputContractHash,
      format: 'JSON_SCHEMA',
      dialect: 'DRAFT_2020_12',
      schema: outputContract.format === 'JSON_SCHEMA' ? outputContract.schema : {},
    },
    inputSchema: z.object({ summary: z.string().min(1) }).strict(),
    agentContractSchema: z.object({ summary: z.string().min(1) }).strict(),
    buildPromptInput: (_input, context) => promptInput(context),
    validateBusiness: (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      !Array.isArray(candidate) &&
      candidate.summary === 'business-rejected'
        ? {
            valid: false,
            issues: [
              {
                code: 'BUSINESS_SUMMARY_REJECTED',
                path: ['summary'],
                message: 'SECRET-CANDIDATE-MUST-NOT-LEAK',
              },
            ],
          }
        : { valid: true, issues: [] },
    ...overrides,
  };
}

function inspector(
  options: {
    readonly adapter?: PromptInspectorAgentAdapter;
    readonly knowledgeLoader?: KnowledgeLoader;
    readonly maxBytes?: number;
    readonly logLines?: string[];
  } = {},
) {
  const quietDependencyLogger = createLogger({ sink: () => undefined });
  return createPromptInspector({
    knowledgeLoader: options.knowledgeLoader ?? knowledgeLoader(),
    promptBuilder: createPromptBuilder({
      configuration: { maxBytes: options.maxBytes ?? 64 * 1024 },
      logger: quietDependencyLogger,
    }),
    responseValidator: createResponseValidator({ logger: quietDependencyLogger }),
    adapters: [options.adapter ?? adapter()],
    ...(options.logLines === undefined
      ? {}
      : {
          logger: createLogger({
            sink: (line) => options.logLines?.push(line),
            now: () => new Date('2026-08-07T12:00:00.000Z'),
          }),
        }),
    now: (() => {
      let tick = 0;
      return () => tick++;
    })(),
  });
}

const REQUEST = {
  agent: 'DEVELOPER' as const,
  input: { summary: 'SECRET-INPUT-MUST-NOT-LEAK' },
};

describe('Prompt Inspector', () => {
  it('publishes a deterministic, immutable catalog for the fixed injected adapters', () => {
    const subject = inspector();
    const first = subject.catalog();
    const second = subject.catalog();

    expect(first).toBe(second);
    expect(first).toMatchObject({
      contractVersion: '1.0.0',
      retention: 'EPHEMERAL',
      pipeline: expect.arrayContaining([{ stage: 'KNOWLEDGE', status: 'IDLE', detail: null }]),
      agents: [
        {
          agent: 'DEVELOPER',
          inputKind: 'PRODUCT_OWNER_SPECIFICATION',
          activeBundleHash: 'b'.repeat(64),
        },
      ],
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.agents[0]?.examples)).toBe(true);
  });

  it('builds a real prompt and projects pipeline, budget, hashes and trust boundaries', async () => {
    const result = await inspector().preview(REQUEST);
    expect(result.status).toBe('BUILT');
    if (result.status !== 'BUILT') return;

    expect(result.prompt.instructions).toContain('Você é um agente de desenvolvimento.');
    expect(result.prompt.input).toContain(KNOWLEDGE_CONTENT);
    expect(result.pipeline.map((node) => node.stage)).toEqual([
      'KNOWLEDGE',
      'RULES',
      'TEMPLATE',
      'RESOLUTION',
      'RENDERING',
      'BUDGET',
      'CONTRACT',
    ]);
    expect(result.pipeline[0]?.status).toBe('WARNING');
    expect(result.budget.usedBytes).toBeLessThanOrEqual(result.budget.maxBytes);
    expect(result.budget.remainingBytes).toBe(result.budget.maxBytes - result.budget.usedBytes);
    expect(result.hashes.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.outputContract.contractHash).toBe(result.hashes.outputContractHash);
    expect(result.trustBoundaries.trustedSectionIds.length).toBeGreaterThan(0);
    expect(result.trustBoundaries.untrustedSectionIds.length).toBeGreaterThan(0);
    expect(result.outputContract.summary).toMatchObject({
      rootTypes: ['object'],
      propertyCount: 1,
      requiredCount: 1,
      truncated: false,
    });
    expect(Object.isFrozen(result.sections[0]?.blocks[0]?.fragments[0])).toBe(true);
  });

  it('projects only allowlisted knowledge metadata and never source locators or content', async () => {
    const result = await inspector().preview(REQUEST);
    expect(result.status).toBe('BUILT');
    if (result.status !== 'BUILT') return;

    const serializedKnowledge = JSON.stringify(result.knowledge);
    expect(result.knowledge.documents[0]).toMatchObject({
      id: 'knowledge:architecture',
      selection: 'REQUIRED',
    });
    expect(result.knowledge.ignored).toEqual([
      { id: 'knowledge:system-design', reason: 'BUDGET_EXCEEDED' },
    ]);
    expect(serializedKnowledge).not.toContain('origin');
    expect(serializedKnowledge).not.toContain('locator');
    expect(serializedKnowledge).not.toContain(KNOWLEDGE_CONTENT);
    expect(serializedKnowledge).not.toContain('inspection-fixture');
  });

  it('validates a manual candidate through all four public validation boundaries', async () => {
    const result = await inspector().validate({
      ...REQUEST,
      candidate: { content: JSON.stringify({ summary: 'valid' }) },
    });

    expect(result).toMatchObject({
      status: 'PASS',
      retention: 'EPHEMERAL',
      stages: [
        { stage: 'RESPONSE_VALIDATOR', status: 'PASS', issuesTruncated: false },
        { stage: 'JSON_SCHEMA', status: 'PASS', issuesTruncated: false },
        { stage: 'AGENT_CONTRACT', status: 'PASS', issuesTruncated: false },
        { stage: 'BUSINESS_VALIDATION', status: 'PASS', issuesTruncated: false },
      ],
    });
    expect(result.candidateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain('responseHash');
    expect(Object.isFrozen(result.stages)).toBe(true);
  });

  it('keeps malformed output in the validation result and does not run downstream stages', async () => {
    const sentinel = 'SECRET-MALFORMED-CANDIDATE';
    const result = await inspector().validate({
      ...REQUEST,
      candidate: { content: `{${sentinel}` },
    });

    expect(result.status).toBe('FAIL');
    expect(result.stages.map((stage) => stage.status)).toEqual([
      'FAIL',
      'NOT_RUN',
      'NOT_RUN',
      'NOT_RUN',
    ]);
    expect(result.stages[0]?.issues.every((issue) => issue.code !== 'SCHEMA_MISMATCH')).toBe(true);
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it('separates JSON Schema issues from the Response Validator visual stage', async () => {
    const result = await inspector().validate({
      ...REQUEST,
      candidate: { content: JSON.stringify({ summary: 42 }) },
    });

    expect(result.stages.map((stage) => stage.status)).toEqual([
      'PASS',
      'FAIL',
      'NOT_RUN',
      'NOT_RUN',
    ]);
    expect(result.stages[0]?.issues).toEqual([]);
    expect(result.stages[1]?.issues).toEqual([
      expect.objectContaining({ code: 'SCHEMA_MISMATCH' }),
    ]);
  });

  it('sanitizes Business Validation messages while preserving code and path', async () => {
    const result = await inspector().validate({
      ...REQUEST,
      candidate: { content: JSON.stringify({ summary: 'business-rejected' }) },
    });
    const businessStage = result.stages[3];

    expect(businessStage).toMatchObject({
      stage: 'BUSINESS_VALIDATION',
      status: 'FAIL',
      issues: [
        {
          code: 'BUSINESS_SUMMARY_REJECTED',
          path: ['summary'],
          message: 'The candidate violates an agent business rule.',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('SECRET-CANDIDATE-MUST-NOT-LEAK');
  });

  it('bounds and marks truncated agent-contract and business issues', async () => {
    const fields = Object.fromEntries(
      Array.from({ length: PROMPT_INSPECTOR_MAX_ISSUES + 1 }, (_, index) => [
        `field${index}`,
        z.string(),
      ]),
    );
    const manyContractIssues = adapter({
      agentContractSchema: z.object(fields).strict(),
    });
    const contractResult = await inspector({ adapter: manyContractIssues }).validate({
      ...REQUEST,
      candidate: { content: JSON.stringify({ summary: 'valid' }) },
    });
    expect(contractResult.stages[2]).toMatchObject({
      status: 'FAIL',
      issuesTruncated: true,
    });
    expect(contractResult.stages[2]?.issues).toHaveLength(PROMPT_INSPECTOR_MAX_ISSUES);

    const manyBusinessIssues = Array.from(
      { length: PROMPT_INSPECTOR_MAX_ISSUES + 1 },
      (_, index) => ({ code: `BUSINESS_${index}`, path: ['summary'], message: `unsafe-${index}` }),
    );
    const businessResult = await inspector({
      adapter: adapter({
        validateBusiness: () => ({ valid: false, issues: manyBusinessIssues }),
      }),
    }).validate({
      ...REQUEST,
      candidate: { content: JSON.stringify({ summary: 'valid' }) },
    });
    expect(businessResult.stages[3]).toMatchObject({ status: 'FAIL', issuesTruncated: true });
    expect(businessResult.stages[3]?.issues).toHaveLength(PROMPT_INSPECTOR_MAX_ISSUES);
  });

  it('returns a rejected preview when the real Prompt Builder budget is exceeded', async () => {
    const result = await inspector({ maxBytes: 256 }).preview(REQUEST);

    expect(result).toMatchObject({
      status: 'REJECTED',
      retention: 'EPHEMERAL',
      error: { code: 'PROMPT_BUILDER_BUDGET_EXCEEDED', stage: 'BUDGET' },
    });
    expect(result.pipeline.find((node) => node.stage === 'BUDGET')?.status).toBe('ERROR');
  });

  it('returns sanitized rejected previews for knowledge and adapter-resolution failures', async () => {
    const knowledgeFailure = await inspector({
      knowledgeLoader: knowledgeLoader(async () => {
        throw new Error('SECRET-KNOWLEDGE-FAILURE');
      }),
    }).preview(REQUEST);
    expect(knowledgeFailure).toMatchObject({
      status: 'REJECTED',
      error: {
        stage: 'KNOWLEDGE',
        code: PROMPT_INSPECTOR_ERROR_CODES.INSPECTION_FAILED,
      },
    });
    expect(JSON.stringify(knowledgeFailure)).not.toContain('SECRET-KNOWLEDGE-FAILURE');

    const resolutionFailure = await inspector({
      adapter: adapter({
        buildPromptInput: () => {
          throw new Error('SECRET-RESOLUTION-FAILURE');
        },
      }),
    }).preview(REQUEST);
    expect(resolutionFailure).toMatchObject({
      status: 'REJECTED',
      error: {
        stage: 'RESOLUTION',
        code: PROMPT_INSPECTOR_ERROR_CODES.INSPECTION_FAILED,
      },
    });
    expect(JSON.stringify(resolutionFailure)).not.toContain('SECRET-RESOLUTION-FAILURE');
  });

  it('does not validate a candidate when prompt construction was rejected', async () => {
    await expect(
      inspector({ maxBytes: 256 }).validate({
        ...REQUEST,
        candidate: { content: JSON.stringify({ summary: 'valid' }) },
      }),
    ).rejects.toMatchObject({
      code: PROMPT_INSPECTOR_ERROR_CODES.INSPECTION_FAILED,
      stage: 'BUDGET',
    });
  });

  it('rejects invalid input before loading knowledge', async () => {
    let loadCount = 0;
    const subject = inspector({
      knowledgeLoader: knowledgeLoader(async () => {
        loadCount += 1;
        return KNOWLEDGE_CONTEXT;
      }),
    });

    await expect(subject.preview({ agent: 'DEVELOPER', input: {} })).rejects.toMatchObject({
      code: PROMPT_INSPECTOR_ERROR_CODES.INVALID_INPUT,
    });
    expect(loadCount).toBe(0);
  });

  it('rejects an agent that is valid in the contract but absent from the fixed composition', async () => {
    await expect(
      inspector().preview({ agent: 'QA', input: { summary: 'handoff' } }),
    ).rejects.toMatchObject({ code: PROMPT_INSPECTOR_ERROR_CODES.UNKNOWN_AGENT });
  });

  it('propagates cancellation before and after the asynchronous Knowledge boundary', async () => {
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(
      inspector().preview(REQUEST, { signal: alreadyAborted.signal }),
    ).rejects.toMatchObject({ code: PROMPT_INSPECTOR_ERROR_CODES.CANCELLED, stage: 'KNOWLEDGE' });

    const duringLoad = new AbortController();
    const subject = inspector({
      knowledgeLoader: knowledgeLoader(async () => {
        duringLoad.abort();
        return KNOWLEDGE_CONTEXT;
      }),
    });
    await expect(subject.preview(REQUEST, { signal: duringLoad.signal })).rejects.toMatchObject({
      code: PROMPT_INSPECTOR_ERROR_CODES.CANCELLED,
      stage: 'KNOWLEDGE',
    });

    await expect(
      inspector().validate(
        { ...REQUEST, candidate: { content: JSON.stringify({ summary: 'valid' }) } },
        { signal: alreadyAborted.signal },
      ),
    ).rejects.toMatchObject({
      code: PROMPT_INSPECTOR_ERROR_CODES.CANCELLED,
      stage: 'KNOWLEDGE',
    });
  });

  it('emits only sanitized metadata and hashes to logs', async () => {
    const lines: string[] = [];
    await inspector({ logLines: lines }).validate({
      ...REQUEST,
      candidate: { content: JSON.stringify({ summary: 'business-rejected' }) },
    });
    const logs = lines.join('\n');

    expect(logs).toContain('candidateHash');
    expect(logs).not.toContain('SECRET-INPUT-MUST-NOT-LEAK');
    expect(logs).not.toContain('business-rejected');
    expect(logs).not.toContain('SECRET-CANDIDATE-MUST-NOT-LEAK');
    expect(logs).not.toContain(KNOWLEDGE_CONTENT);
  });

  it('rejects duplicate adapters and a catalog larger than the three supported agents', () => {
    const common = {
      knowledgeLoader: knowledgeLoader(),
      promptBuilder: createPromptBuilder(),
      responseValidator: createResponseValidator(),
    };
    expect(() => createPromptInspector({ ...common, adapters: [adapter(), adapter()] })).toThrow(
      PromptInspectorError,
    );
    expect(() =>
      createPromptInspector({
        ...common,
        adapters: [adapter(), adapter(), adapter(), adapter()],
      }),
    ).toThrow(PromptInspectorError);
    expect(() =>
      createPromptInspector({
        ...common,
        adapters: [adapter({ activeBundleHash: 'invalid' })],
      }),
    ).toThrow(PromptInspectorError);
  });
});
