// @vitest-environment node

import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';

import type { PromptRequest } from '@brq/agent-runner';
import { FakeAIProvider } from '@brq/ai-provider/fake';
import {
  createDeveloperAIResponse,
  createTechnicalSpecification,
} from '../../../../agents/developer/testing/developer-fixtures';
import {
  createProductOwnerAIResponse,
  createProductOwnerRequest,
  createProductOwnerSpecification,
} from '../../../../agents/product-owner/testing/product-owner-fixtures';
import {
  createQAAIResponse,
  createQASpecification,
} from '../../../../agents/qa/testing/qa-fixtures';
import { createDeveloperAgentRunRequest } from '../../../../agents/developer/prompt-request';
import { projectDeveloperPromptContexts } from '../../../../agents/developer/knowledge-projection';
import { createDeveloperRequest } from '../../../../agents/developer/testing/developer-fixtures';
import { projectProductOwnerPromptContexts } from '../../../../agents/product-owner/knowledge-projection';
import { createProductOwnerAgentRunRequest } from '../../../../agents/product-owner/prompt-request';
import { projectQAPromptContexts } from '../../../../agents/qa/knowledge-projection';
import { createQAAgentRunRequest } from '../../../../agents/qa/prompt-request';
import { createQARequest } from '../../../../agents/qa/testing/qa-fixtures';
import {
  developerAgentRequestSchema,
  loadDeveloperPromptAssets,
  validateDeveloperBusinessRules,
} from '@brq/developer-agent';
import { executionRequestSchema } from '@brq/execution-engine';
import {
  createKnowledgeLoader,
  KNOWLEDGE_MANIFEST,
  type KnowledgeLoader,
} from '@brq/knowledge-loader';
import { FilesystemKnowledgeSource } from '@brq/knowledge-loader/filesystem';
import {
  loadProductOwnerPromptAssets,
  productOwnerAgentRequestSchema,
  validateProductOwnerBusinessRules,
} from '@brq/product-owner-agent';
import {
  calculatePromptHash,
  createPromptBuilder,
  DEFAULT_PROMPT_MAX_BYTES,
  PROMPT_BUILDER_ERROR_CODES,
  type PromptBuildInput,
} from '@brq/prompt-builder';
import { createPromptBuildInput } from '@brq/prompt-builder/testing';
import { loadQAPromptAssets, qaAgentRequestSchema } from '@brq/qa-agent';
import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import { capturedLogger, executionBody, FIXED_REQUEST_ID } from '../test/api-fixtures';
import { AI_FACTORY_PROMPT_BUILDER_MAX_BYTES, createApplicationRuntime } from './runtime';

const KNOWLEDGE_ROOT = fileURLToPath(new URL('../../../../knowledge', import.meta.url));
const FITTING_PAYLOAD_BYTES = 400 * 1024;
const REAL_WORKFLOW_TEST_TIMEOUT_MS = 10_000;

function fill(length: number): string {
  return 'x'.repeat(length);
}

function denseId(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(3, '0')}`;
}

function createDenseProductOwnerSpecification() {
  const acceptanceCriteria = Array.from({ length: 10 }, (_, index) => ({
    id: denseId('AC', index),
    given: fill(600),
    when: fill(600),
    then: fill(600),
  }));

  return createProductOwnerSpecification({
    readiness: 'PARTIALLY_READY',
    summary: fill(2_000),
    objective: fill(2_000),
    context: fill(4_000),
    userStory: { asA: fill(500), iWant: fill(500), soThat: fill(500) },
    acceptanceCriteria,
    businessRules: Array.from({ length: 10 }, (_, index) => ({
      id: denseId('BR', index),
      description: fill(800),
      source: fill(500),
      condition: fill(500),
      impact: 'MEDIUM' as const,
    })),
    scenarios: Array.from({ length: 10 }, (_, index) => ({
      id: denseId('SCN', index),
      title: fill(100),
      type: index === 0 ? ('MAIN' as const) : ('ALTERNATIVE' as const),
      given: [fill(400), fill(400)],
      when: [fill(400), fill(400)],
      then: [fill(400), fill(400)],
      acceptanceCriteriaIds: [denseId('AC', index)],
    })),
    assumptions: Array.from({ length: 5 }, (_, index) => ({
      id: denseId('ASM', index),
      description: fill(800),
      requiresValidation: false,
    })),
    dependencies: Array.from({ length: 5 }, (_, index) => ({
      id: denseId('DEP', index),
      description: fill(800),
    })),
    risks: Array.from({ length: 5 }, (_, index) => ({
      id: denseId('RSK', index),
      description: fill(800),
      impact: 'MEDIUM' as const,
      mitigation: fill(800),
    })),
    openQuestions: Array.from({ length: 5 }, (_, index) => ({
      id: denseId('Q', index),
      question: fill(800),
      impact: 'NON_BLOCKING' as const,
    })),
    outOfScope: Array.from({ length: 5 }, (_, index) => ({
      id: denseId('OOS', index),
      description: fill(800),
    })),
    definitionOfReady: Array.from({ length: 5 }, (_, index) => ({
      id: denseId('DOR', index),
      criterion: fill(800),
    })),
    backlogItems: Array.from({ length: 10 }, (_, index) => ({
      id: denseId('BL', index),
      title: fill(100),
      description: fill(1_000),
      priority: 'HIGH' as const,
      dependencyIds: [],
      acceptanceCriteriaIds: [denseId('AC', index)],
    })),
  });
}

function createDenseTechnicalSpecification() {
  return createTechnicalSpecification({
    readiness: 'PARTIALLY_READY',
    summary: fill(2_000),
    objective: fill(2_000),
    architecture: {
      overview: fill(4_000),
      style: fill(200),
      rationale: fill(2_000),
      principles: Array.from({ length: 20 }, () => fill(1_000)),
      constraints: Array.from({ length: 30 }, () => fill(1_000)),
      qualityAttributes: Array.from({ length: 20 }, () => fill(1_000)),
      trustBoundaries: Array.from({ length: 30 }, () => fill(1_000)),
    },
    decisions: Array.from({ length: 4 }, (_, index) => ({
      id: denseId('DEC', index),
      title: fill(160),
      context: fill(2_000),
      decision: fill(2_000),
      alternatives: Array.from({ length: 3 }, () => fill(1_000)),
      tradeOffs: Array.from({ length: 3 }, () => ({
        benefit: fill(1_000),
        cost: fill(1_000),
      })),
      rationale: fill(2_000),
      requiresAdr: false,
      componentIds: ['CMP-001'],
      moduleIds: ['MOD-001'],
    })),
    traceability: Array.from({ length: 10 }, (_, index) => ({
      id: denseId('TRC', index),
      sourceIds: [denseId('AC', index), denseId('BL', index)],
      componentIds: ['CMP-001'],
      moduleIds: ['MOD-001'],
      flowIds: ['FLW-001'],
      contractIds: ['CTR-001'],
      apiIds: ['API-001'],
      eventIds: [],
      implementationPlanIds: ['PLAN-001'],
      technicalBacklogIds: ['TBL-001'],
      definitionOfDoneIds: ['DOD-001'],
    })),
  });
}

function toPromptBuildInput(prompt: PromptRequest): PromptBuildInput {
  return {
    template: prompt.template,
    ruleSets: prompt.ruleSets,
    contexts: prompt.contexts,
    variables: prompt.variables,
    constraints: prompt.constraints,
    outputContract: prompt.outputContract,
  };
}

function withKnowledgeContent(input: PromptBuildInput, content: string): PromptBuildInput {
  const firstContext = input.contexts[0];
  if (firstContext === undefined) throw new Error('Fixture sem contexto.');

  return {
    ...input,
    contexts: [
      {
        ...firstContext,
        content,
        contentHash: `sha256:${calculatePromptHash(content)}`,
      },
      ...input.contexts.slice(1),
    ],
  };
}

async function createRealKnowledgeLoader(): Promise<KnowledgeLoader> {
  const logger = createLogger({ sink: () => undefined });
  const source = new FilesystemKnowledgeSource({
    sourceId: 'knowledge-filesystem-prompt-budget-test',
    rootPath: KNOWLEDGE_ROOT,
    allowedLocators: KNOWLEDGE_MANIFEST.documents.map((document) => document.locator),
  });
  return createKnowledgeLoader({ source, logger, now: () => 0 });
}

describe('AI Factory host Prompt Builder budget', () => {
  it('keeps the core default unchanged and configures the host below every agent ceiling', () => {
    expect(DEFAULT_PROMPT_MAX_BYTES).toBe(128 * 1024);
    expect(AI_FACTORY_PROMPT_BUILDER_MAX_BYTES).toBe(512 * 1024);
    expect(AI_FACTORY_PROMPT_BUILDER_MAX_BYTES).toBeLessThanOrEqual(1024 * 1024);
    expect([
      productOwnerAgentRequestSchema.safeParse(
        createProductOwnerRequest({
          limits: { promptMaxBytes: AI_FACTORY_PROMPT_BUILDER_MAX_BYTES },
        }),
      ).success,
      developerAgentRequestSchema.safeParse(
        createDeveloperRequest({
          limits: { promptMaxBytes: AI_FACTORY_PROMPT_BUILDER_MAX_BYTES },
        }),
      ).success,
      qaAgentRequestSchema.safeParse(
        createQARequest({
          limits: { promptMaxBytes: AI_FACTORY_PROMPT_BUILDER_MAX_BYTES },
        }),
      ).success,
    ]).toEqual([true, true, true]);
  });

  it('fits representative Product Owner and dense downstream specifications with real assets', async () => {
    const knowledgeLoader = await createRealKnowledgeLoader();
    const promptBuilder = createPromptBuilder({
      configuration: { maxBytes: AI_FACTORY_PROMPT_BUILDER_MAX_BYTES },
      logger: createLogger({ sink: () => undefined }),
      now: () => 0,
    });

    const productOwnerAssets = loadProductOwnerPromptAssets();
    const productOwnerRequest = createProductOwnerRequest();
    const productOwnerKnowledge = await knowledgeLoader.load({ context: 'PRODUCT_OWNER' });
    const productOwnerContexts = projectProductOwnerPromptContexts(
      productOwnerKnowledge,
      productOwnerRequest,
      productOwnerAssets.manifest,
    );
    const productOwnerPrompt = promptBuilder.build(
      toPromptBuildInput(
        createProductOwnerAgentRunRequest(
          productOwnerRequest,
          productOwnerContexts,
          productOwnerAssets,
        ).prompt,
      ),
    );

    const denseProductOwnerSpecification = createDenseProductOwnerSpecification();
    const developerAssets = loadDeveloperPromptAssets();
    const developerRequest = createDeveloperRequest({
      productOwnerSpecification: denseProductOwnerSpecification,
    });
    const developerKnowledge = await knowledgeLoader.load({ context: 'DEVELOPER' });
    const developerContexts = projectDeveloperPromptContexts(
      developerKnowledge,
      developerRequest,
      developerAssets.manifest,
    );
    const developerPrompt = promptBuilder.build(
      toPromptBuildInput(
        createDeveloperAgentRunRequest(developerRequest, developerContexts, developerAssets).prompt,
      ),
    );

    const denseTechnicalSpecification = createDenseTechnicalSpecification();
    expect(validateProductOwnerBusinessRules(denseProductOwnerSpecification).valid).toBe(true);
    expect(
      validateDeveloperBusinessRules(denseTechnicalSpecification, denseProductOwnerSpecification)
        .valid,
    ).toBe(true);
    const qaAssets = loadQAPromptAssets();
    const qaRequest = createQARequest({
      productOwnerSpecification: denseProductOwnerSpecification,
      technicalSpecification: denseTechnicalSpecification,
    });
    const qaKnowledge = await knowledgeLoader.load({ context: 'QA' });
    const qaContexts = projectQAPromptContexts(qaKnowledge, qaRequest, qaAssets.manifest);
    const qaPrompt = promptBuilder.build(
      toPromptBuildInput(createQAAgentRunRequest(qaRequest, qaContexts, qaAssets).prompt),
    );

    expect({
      productOwnerKnowledgeBytes: Buffer.byteLength(productOwnerKnowledge.content, 'utf8'),
      developerKnowledgeBytes: Buffer.byteLength(developerKnowledge.content, 'utf8'),
      qaKnowledgeBytes: Buffer.byteLength(qaKnowledge.content, 'utf8'),
      productOwnerSpecificationBytes: Buffer.byteLength(
        JSON.stringify(denseProductOwnerSpecification),
        'utf8',
      ),
      technicalSpecificationBytes: Buffer.byteLength(
        JSON.stringify(denseTechnicalSpecification),
        'utf8',
      ),
    }).toEqual({
      productOwnerKnowledgeBytes: 60_545,
      developerKnowledgeBytes: 65_037,
      qaKnowledgeBytes: 64_933,
      productOwnerSpecificationBytes: 114_931,
      technicalSpecificationBytes: 178_346,
    });
    expect(productOwnerPrompt.budget).toEqual({
      maxBytes: AI_FACTORY_PROMPT_BUILDER_MAX_BYTES,
      usedBytes: 100_523,
      instructionsBytes: 30_361,
      inputBytes: 63_322,
      outputContractBytes: 6_840,
    });
    expect(developerPrompt.budget).toEqual({
      maxBytes: AI_FACTORY_PROMPT_BUILDER_MAX_BYTES,
      usedBytes: 258_803,
      instructionsBytes: 55_146,
      inputBytes: 182_548,
      outputContractBytes: 21_109,
    });
    expect(qaPrompt.budget).toEqual({
      maxBytes: AI_FACTORY_PROMPT_BUILDER_MAX_BYTES,
      usedBytes: 405_631,
      instructionsBytes: 33_886,
      inputBytes: 362_092,
      outputContractBytes: 9_653,
    });
    expect(qaPrompt.budget.usedBytes).toBeLessThan(AI_FACTORY_PROMPT_BUILDER_MAX_BYTES);
  });

  it(
    'uses the explicit host budget across the real workflow with only the fake provider',
    { timeout: REAL_WORKFLOW_TEST_TIMEOUT_MS },
    async () => {
      const provider = new FakeAIProvider([
        {
          type: 'success',
          response: createProductOwnerAIResponse(createProductOwnerSpecification(), {
            model: 'gpt-5-mini',
          }),
        },
        {
          type: 'success',
          response: createDeveloperAIResponse(createTechnicalSpecification(), {
            model: 'gpt-5-mini',
          }),
        },
        {
          type: 'success',
          response: createQAAIResponse(createQASpecification(), { model: 'gpt-5-mini' }),
        },
      ]);
      const { logger, records } = capturedLogger();
      const engine = await createApplicationRuntime({
        aiProvider: provider,
        environment: { NODE_ENV: 'test' },
        knowledgeRoot: KNOWLEDGE_ROOT,
        logger,
        now: () => 0,
      });
      const request = executionRequestSchema.parse({
        ...executionBody(),
        requestId: FIXED_REQUEST_ID,
      });

      const result = await engine.execute(request);
      const promptRecords = records.filter((record) => record.event === 'prompt.build.completed');

      expect(result.status).toBe('SUCCESS');
      expect(provider.provider).toBe('fake');
      expect(provider.calls).toHaveLength(3);
      expect(promptRecords.map((record) => record.agent)).toEqual([
        'PRODUCT_OWNER',
        'DEVELOPER',
        'QA',
      ]);
      expect(promptRecords.find((record) => record.agent === 'PRODUCT_OWNER')?.version).toBe(
        '1.0.1',
      );
      expect(promptRecords.find((record) => record.agent === 'DEVELOPER')?.version).toBe('1.0.2');
      expect(promptRecords.every((record) => record.maxBytes === 512 * 1024)).toBe(true);
      expect(
        promptRecords.find((record) => record.agent === 'DEVELOPER')?.usedBytes,
      ).toBeGreaterThan(DEFAULT_PROMPT_MAX_BYTES);
    },
  );

  it('renders fitting content completely and rejects content above the host limit', () => {
    const promptBuilder = createPromptBuilder({
      configuration: { maxBytes: AI_FACTORY_PROMPT_BUILDER_MAX_BYTES },
      logger: createLogger({ sink: () => undefined }),
      now: () => 0,
    });
    const fittingContent = `${fill(FITTING_PAYLOAD_BYTES)}END-OF-CONTEXT`;
    const fittingInput = withKnowledgeContent(createPromptBuildInput(), fittingContent);

    const fittingResult = promptBuilder.build(fittingInput);

    expect(fittingResult.rendered.input).toContain(fittingContent);
    expect(fittingResult.budget.maxBytes).toBe(AI_FACTORY_PROMPT_BUILDER_MAX_BYTES);
    expect(fittingResult.budget.usedBytes).toBeLessThan(AI_FACTORY_PROMPT_BUILDER_MAX_BYTES);

    const oversizedContent = `${fill(AI_FACTORY_PROMPT_BUILDER_MAX_BYTES)}END-OF-CONTEXT`;
    const oversizedInput = withKnowledgeContent(createPromptBuildInput(), oversizedContent);

    expect(() => promptBuilder.build(oversizedInput)).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.BUDGET_EXCEEDED }),
    );
    expect(oversizedInput.contexts[0]?.content).toBe(oversizedContent);
  });
});
