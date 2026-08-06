import { createAgentRunner } from '@brq/agent-runner';
import { createArtifactGenerator, type ArtifactGenerator } from '@brq/artifact-generator';
import { createKnowledgeLoader, type KnowledgeLoader } from '@brq/knowledge-loader';
import { calculateCanonicalJsonHash, createPromptBuilder } from '@brq/prompt-builder';
import { createResponseValidator, type ResponseValidator } from '@brq/response-validator';
import { createLogger } from '@brq/shared/logger/logger';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import {
  FakeAIProvider,
  type FakeAIProviderOutcome,
} from '../../core/ai-provider/fake/fake-ai-provider';
import { FakeKnowledgeSource } from '../../core/knowledge-loader/testing/fake-knowledge-source';
import { createTechnicalSpecification } from '../developer/testing/developer-fixtures';
import { QA_AGENT_ERROR_CODES, QAAgentError } from './errors';
import { createQAAgent } from './qa-agent';
import { loadQAPromptAssets } from './prompt-assets';
import { createQAAIResponse, createQARequest, createQASpecification } from './testing/qa-fixtures';

const EMPTY_SELECTION = { required: [], optional: [] } as const;
const KNOWLEDGE_MANIFEST = {
  version: '1.0.0',
  documents: [{ id: 'knowledge:qa-test', locator: 'qa.md', category: 'AGENT', order: 1 }],
} as const;
const KNOWLEDGE_POLICY = {
  version: '1.0.0',
  contexts: {
    GLOBAL: EMPTY_SELECTION,
    PRODUCT_OWNER: EMPTY_SELECTION,
    DEVELOPER: EMPTY_SELECTION,
    QA: { required: ['knowledge:qa-test'], optional: [] },
    SECURITY: EMPTY_SELECTION,
    ARCHITECTURE: EMPTY_SELECTION,
  },
} as const;

interface HarnessOptions {
  readonly outcomes?: FakeAIProviderOutcome[];
  readonly knowledgeLoader?: KnowledgeLoader;
  readonly responseValidator?: ResponseValidator;
  readonly artifactGenerator?: ArtifactGenerator;
}

async function createHarness(options: HarnessOptions = {}) {
  const logLines: string[] = [];
  const logger = createLogger({ sink: (line) => logLines.push(line) });
  const source = new FakeKnowledgeSource({
    documents: { 'qa.md': '# QA\n\nProduza somente uma especificação declarativa.' },
  });
  const defaultKnowledgeLoader = await createKnowledgeLoader({
    source,
    manifest: KNOWLEDGE_MANIFEST,
    policy: KNOWLEDGE_POLICY,
    logger,
  });
  const provider = new FakeAIProvider(
    options.outcomes ?? [
      { type: 'success', response: createQAAIResponse(createQASpecification()) },
    ],
  );
  const agentRunner = createAgentRunner({
    promptBuilder: createPromptBuilder({ logger }),
    aiProvider: provider,
    logger,
  });
  const agent = createQAAgent({
    knowledgeLoader: options.knowledgeLoader ?? defaultKnowledgeLoader,
    agentRunner,
    responseValidator: options.responseValidator ?? createResponseValidator({ logger }),
    artifactGenerator: options.artifactGenerator ?? createArtifactGenerator({ logger }),
    promptAssets: loadQAPromptAssets(),
    logger,
  });
  return { agent, provider, logLines };
}

describe('QAAgent', () => {
  it('executa uma única tentativa e produz os três drafts canônicos', async () => {
    const { agent, provider, logLines } = await createHarness();
    const request = createQARequest();
    const snapshot = structuredClone(request);
    const result = await agent.execute(request);

    expect(result.outcome).toBe('GENERATED');
    expect(result.readiness).toBe('READY');
    expect(result.artifacts.map(({ draft }) => draft.filename)).toEqual([
      'test-plan.md',
      'traceability-matrix.json',
      'qa-specification.md',
    ]);
    expect(JSON.parse(result.artifacts[1]!.draft.content)).toEqual(
      result.specification?.traceability,
    );
    expect(result.metadata.knowledge.context).toBe('QA');
    expect(result.metadata.run.prompt.metadata.agent).toBe('QA');
    expect(result.metadata.productOwnerSpecificationHash).toBe(
      `sha256:${calculateCanonicalJsonHash(request.productOwnerSpecification as unknown as JsonValue)}`,
    );
    expect(result.metadata.technicalSpecificationHash).toBe(
      `sha256:${calculateCanonicalJsonHash(request.technicalSpecification as unknown as JsonValue)}`,
    );
    expect(provider.calls).toHaveLength(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.specification)).toBe(true);
    expect(request).toEqual(snapshot);
    expect(Object.isFrozen(request)).toBe(false);
    expect(logLines.some((line) => line.includes('qa.agent.completed'))).toBe(true);
  });

  it('preserva hashes e drafts determinísticos para entradas idênticas', async () => {
    const response = createQAAIResponse(createQASpecification());
    const { agent } = await createHarness({
      outcomes: [
        { type: 'success', response },
        { type: 'success', response: structuredClone(response) },
      ],
    });
    const first = await agent.execute(createQARequest());
    const second = await agent.execute(createQARequest());
    expect(first.metadata.run.prompt.metadata.promptHash).toBe(
      second.metadata.run.prompt.metadata.promptHash,
    );
    expect(first.artifacts).toEqual(second.artifacts);
    expect(first.metadata.generation?.generationHash).toBe(
      second.metadata.generation?.generationHash,
    );
  });

  it('encaminha limites explícitos e aceita contexto sem correlações opcionais', async () => {
    const { agent, provider } = await createHarness();
    const base = createQARequest();
    const result = await agent.execute(
      createQARequest({
        context: {
          executionId: base.context.executionId,
          agentExecutionId: base.context.agentExecutionId,
          attempt: 1,
          agentVersion: '1.0.0',
        },
        limits: {
          knowledgeMaxDocuments: 10,
          knowledgeMaxBytes: 64 * 1024,
          promptMaxBytes: 128 * 1024,
          maxOutputTokens: 4096,
          timeoutMs: 30_000,
        },
      }),
    );
    expect(result.outcome).toBe('GENERATED');
    expect(provider.calls[0]?.request.maxOutputTokens).toBe(4096);
    expect(provider.calls[0]?.options.timeoutMs).toBe(30_000);
  });

  it('rejeita fontes incompatíveis antes de carregar knowledge ou chamar o provider', async () => {
    const { agent, provider } = await createHarness();
    const technicalSpecification = createTechnicalSpecification({ traceability: [] });
    await expect(agent.execute(createQARequest({ technicalSpecification }))).rejects.toMatchObject({
      code: QA_AGENT_ERROR_CODES.INCOMPATIBLE_SOURCE_SPECIFICATIONS,
      stage: 'SOURCE_VALIDATION',
    });
    expect(provider.calls).toHaveLength(0);
  });

  it('retorna rejeição do Response Validator sem artifacts', async () => {
    const { agent, provider } = await createHarness({ outcomes: [{ type: 'malformed_json' }] });
    const result = await agent.execute(createQARequest());
    expect(result.outcome).toBe('VALIDATION_REJECTED');
    expect(result.outcome === 'VALIDATION_REJECTED' ? result.rejectedAt : null).toBe(
      'RESPONSE_VALIDATION',
    );
    expect(result.artifacts).toEqual([]);
    expect(result.metadata.generation).toBeNull();
    expect(provider.calls).toHaveLength(1);
  });

  it('retorna rejeição da Business Validation sem corrigir a saída', async () => {
    const base = createQASpecification();
    const invalid = createQASpecification({
      traceability: {
        ...base.traceability,
        summary: { ...base.traceability.summary, acceptanceCriteria: { total: 1, covered: 0 } },
      },
    });
    const { agent } = await createHarness({
      outcomes: [{ type: 'success', response: createQAAIResponse(invalid) }],
    });
    const result = await agent.execute(createQARequest());
    expect(result.outcome).toBe('VALIDATION_REJECTED');
    expect(result.outcome === 'VALIDATION_REJECTED' ? result.rejectedAt : null).toBe(
      'BUSINESS_VALIDATION',
    );
    expect(result.specification).toBeNull();
    expect(result.artifacts).toEqual([]);
  });

  it('preserva readiness parcial das duas fontes', async () => {
    const request = createQARequest({
      productOwnerSpecification: {
        ...createQARequest().productOwnerSpecification,
        readiness: 'PARTIALLY_READY',
        openQuestions: [{ id: 'Q-001', question: 'Qual o SLA esperado?', impact: 'NON_BLOCKING' }],
      },
      technicalSpecification: createTechnicalSpecification({ readiness: 'PARTIALLY_READY' }),
    });
    const specification = createQASpecification({ readiness: 'PARTIALLY_READY' });
    const { agent } = await createHarness({
      outcomes: [{ type: 'success', response: createQAAIResponse(specification) }],
    });
    const result = await agent.execute(request);
    expect(result.outcome).toBe('GENERATED');
    expect(result.readiness).toBe('PARTIALLY_READY');
  });

  it.each([
    ['timeout', { type: 'timeout' } as const, QA_AGENT_ERROR_CODES.TIMEOUT],
    ['cancelamento do provider', { type: 'cancelled' } as const, QA_AGENT_ERROR_CODES.CANCELLED],
    ['falha permanente', { type: 'permanent_failure' } as const, QA_AGENT_ERROR_CODES.RUN_FAILED],
  ])('traduz %s do runner sem retry', async (_label, outcome, code) => {
    const { agent, provider } = await createHarness({ outcomes: [outcome] });
    await expect(agent.execute(createQARequest())).rejects.toMatchObject({
      code,
      stage: 'RUNNER_EXECUTION',
    });
    expect(provider.calls).toHaveLength(1);
  });

  it('classifica falhas de knowledge e geração no estágio correto', async () => {
    const failingKnowledge = {
      load: async () => {
        throw Object.assign(new Error('conteúdo sensível'), { code: 'KNOWLEDGE_SOURCE_FAILURE' });
      },
    } as unknown as KnowledgeLoader;
    const knowledgeHarness = await createHarness({ knowledgeLoader: failingKnowledge });
    await expect(knowledgeHarness.agent.execute(createQARequest())).rejects.toMatchObject({
      code: QA_AGENT_ERROR_CODES.KNOWLEDGE_LOAD_FAILED,
      stage: 'KNOWLEDGE_LOADING',
    });
    expect(knowledgeHarness.provider.calls).toHaveLength(0);

    const failingGenerator = {
      generate: () => {
        throw new Error('conteúdo sensível');
      },
    } as ArtifactGenerator;
    const generationHarness = await createHarness({ artifactGenerator: failingGenerator });
    await expect(generationHarness.agent.execute(createQARequest())).rejects.toMatchObject({
      code: QA_AGENT_ERROR_CODES.ARTIFACT_GENERATION_FAILED,
      stage: 'ARTIFACT_GENERATION',
    });
    expect(generationHarness.provider.calls).toHaveLength(1);
  });

  it('respeita cancelamento antes da inferência', async () => {
    const { agent, provider } = await createHarness();
    const controller = new AbortController();
    controller.abort();
    await expect(
      agent.execute(createQARequest(), { signal: controller.signal }),
    ).rejects.toBeInstanceOf(QAAgentError);
    expect(provider.calls).toHaveLength(0);
  });

  it('rejeita configuração e request inválidos com erros classificados', async () => {
    const { agent } = await createHarness();
    await expect(agent.execute({ ...createQARequest(), model: ' ' })).rejects.toMatchObject({
      code: QA_AGENT_ERROR_CODES.INVALID_REQUEST,
      stage: 'REQUEST_VALIDATION',
    });
    expect(() =>
      createQAAgent({
        knowledgeLoader: null as never,
        agentRunner: null as never,
        responseValidator: null as never,
        artifactGenerator: null as never,
        promptAssets: loadQAPromptAssets(),
      }),
    ).toThrow(QAAgentError);
  });
});
