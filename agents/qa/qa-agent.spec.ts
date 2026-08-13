import { createAgentRunner } from '@brq/agent-runner';
import { createArtifactGenerator, type ArtifactGenerator } from '@brq/artifact-generator';
import { createKnowledgeLoader, type KnowledgeLoader } from '@brq/knowledge-loader';
import { calculateCanonicalJsonHash, createPromptBuilder } from '@brq/prompt-builder';
import { createResponseValidator, type ResponseValidator } from '@brq/response-validator';
import {
  CHANGE_DELIVERY_INTENT,
  GREENFIELD_DELIVERY_INTENT,
} from '@brq/shared/constants/delivery-intent';
import { createLogger } from '@brq/shared/logger/logger';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import {
  FakeAIProvider,
  type FakeAIProviderOutcome,
} from '../../core/ai-provider/fake/fake-ai-provider';
import { FakeKnowledgeSource } from '../../core/knowledge-loader/testing/fake-knowledge-source';
import { createTechnicalSpecification } from '../developer/testing/developer-fixtures';
import { createProductOwnerSpecification } from '../product-owner/testing/product-owner-fixtures';
import { QA_BUSINESS_VALIDATION_ISSUE_CODES } from './business-validation';
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
    CODE_GENERATOR: EMPTY_SELECTION,
    SECURITY: EMPTY_SELECTION,
    ARCHITECTURE: EMPTY_SELECTION,
  },
} as const;
const THREE_BUSINESS_RULES = [
  {
    id: 'BR-001',
    description: 'O texto deve ser obrigatório.',
    source: 'Escopo funcional.',
    condition: 'Texto informado.',
    impact: 'HIGH',
  },
  {
    id: 'BR-002',
    description: 'Espaços também contam como caracteres.',
    source: 'Escopo funcional.',
    condition: 'Texto contém espaços.',
    impact: 'MEDIUM',
  },
  {
    id: 'BR-003',
    description: 'O resultado deve refletir o texto atual.',
    source: 'Escopo funcional.',
    condition: 'Texto alterado.',
    impact: 'HIGH',
  },
] as const;

function createThreeBusinessRuleSpecification(readiness: 'READY' | 'PARTIALLY_READY' = 'READY') {
  const base = createQASpecification();
  const functionalSourceIds = ['AC-001', 'BR-001', 'BR-002', 'BR-003'] as const;
  return createQASpecification({
    readiness,
    positiveScenarios: [
      { ...base.positiveScenarios[0]!, functionalReferences: functionalSourceIds },
    ],
    traceability: {
      ...base.traceability,
      summary: {
        ...base.traceability.summary,
        businessRules: { total: 3, covered: 3 },
      },
      functionalCoverage: functionalSourceIds.map((sourceId) => ({
        sourceId,
        scenarioIds: ['QAP-001' as const],
      })),
      matrix: [
        {
          ...base.traceability.matrix[0]!,
          functionalSourceIds,
        },
      ],
    },
  });
}

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
  const exactCacheProvider = Object.assign(provider, {
    capabilities: Object.freeze({ exactResponseCache: true as const }),
  });
  const agentRunner = createAgentRunner({
    promptBuilder: createPromptBuilder({ logger }),
    aiProvider: exactCacheProvider,
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
    const result = await agent.execute(request, {
      cacheMode: 'REQUIRE_HIT',
      sourceExecutionId: request.context.executionId,
    });

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
    expect(provider.calls[0]?.options.cacheMode).toBe('REQUIRE_HIT');
    expect(provider.calls[0]?.options.sourceExecutionId).toBe(request.context.executionId);
    expect(provider.calls[0]?.request.input).not.toContain('deliveryIntent');
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

  it('aplica a semântica CREATE na source validation sem projetar o intent no prompt', async () => {
    const base = createTechnicalSpecification();
    const technicalSpecification = createTechnicalSpecification({
      components: base.components.map((component) => ({
        ...component,
        changeType: 'MODIFY' as const,
      })),
      modules: base.modules.map((module) => ({
        ...module,
        changeType: 'DELETE' as const,
      })),
    });
    const greenfield = await createHarness();

    await expect(
      greenfield.agent.execute(
        createQARequest({ technicalSpecification, deliveryIntent: GREENFIELD_DELIVERY_INTENT }),
      ),
    ).rejects.toMatchObject({
      code: QA_AGENT_ERROR_CODES.INCOMPATIBLE_SOURCE_SPECIFICATIONS,
      stage: 'SOURCE_VALIDATION',
    });
    expect(greenfield.provider.calls).toHaveLength(0);

    const change = await createHarness();
    const result = await change.agent.execute(
      createQARequest({ technicalSpecification, deliveryIntent: CHANGE_DELIVERY_INTENT }),
    );
    expect(result.outcome).toBe('GENERATED');
    expect(change.provider.calls).toHaveLength(1);
    expect(change.provider.calls[0]?.request.input).not.toContain('deliveryIntent');
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

  it('gera artifacts quando uma dúvida própria não bloqueante declara readiness parcial', async () => {
    const specification = createQASpecification({
      readiness: 'PARTIALLY_READY',
      openQuestions: [
        {
          id: 'QQ-001',
          question: 'Qual será o volume esperado em produção?',
          impact: 'NON_BLOCKING',
        },
      ],
    });
    const { agent, provider } = await createHarness({
      outcomes: [{ type: 'success', response: createQAAIResponse(specification) }],
    });

    const result = await agent.execute(createQARequest());

    expect(result.outcome).toBe('GENERATED');
    expect(result.readiness).toBe('PARTIALLY_READY');
    expect(result.artifacts).toHaveLength(3);
    expect(provider.calls).toHaveLength(1);
  });

  it('gera artifacts com três Business Rules integralmente cobertas usando FakeAIProvider', async () => {
    const productOwnerSpecification = createProductOwnerSpecification({
      readiness: 'PARTIALLY_READY',
      businessRules: THREE_BUSINESS_RULES,
      openQuestions: [
        { id: 'Q-001', question: 'Qual o limite máximo de texto?', impact: 'NON_BLOCKING' },
      ],
    });
    const request = createQARequest({
      productOwnerSpecification,
      technicalSpecification: createTechnicalSpecification({ readiness: 'PARTIALLY_READY' }),
    });
    const specification = createThreeBusinessRuleSpecification('PARTIALLY_READY');
    const { agent, provider } = await createHarness({
      outcomes: [{ type: 'success', response: createQAAIResponse(specification) }],
    });

    const result = await agent.execute(request);

    expect(result.outcome).toBe('GENERATED');
    expect(result.readiness).toBe('PARTIALLY_READY');
    expect(result.validation.business).toMatchObject({ valid: true, issues: [] });
    expect(result.artifacts).toHaveLength(3);
    expect(provider.calls).toHaveLength(1);
  });

  it('rejeita Business Rule omitida sem retry, autocorreção ou artifacts', async () => {
    const complete = createThreeBusinessRuleSpecification('PARTIALLY_READY');
    const specification = createQASpecification({
      ...complete,
      traceability: {
        ...complete.traceability,
        summary: {
          ...complete.traceability.summary,
          businessRules: { total: 3, covered: 2 },
        },
        functionalCoverage: complete.traceability.functionalCoverage.filter(
          ({ sourceId }) => sourceId !== 'BR-002',
        ),
      },
    });
    const request = createQARequest({
      productOwnerSpecification: createProductOwnerSpecification({
        readiness: 'PARTIALLY_READY',
        businessRules: THREE_BUSINESS_RULES,
        openQuestions: [
          { id: 'Q-001', question: 'Qual o limite máximo de texto?', impact: 'NON_BLOCKING' },
        ],
      }),
      technicalSpecification: createTechnicalSpecification({ readiness: 'PARTIALLY_READY' }),
    });
    const { agent, provider } = await createHarness({
      outcomes: [{ type: 'success', response: createQAAIResponse(specification) }],
    });

    const result = await agent.execute(request);

    expect(result.outcome).toBe('VALIDATION_REJECTED');
    expect(result.outcome === 'VALIDATION_REJECTED' ? result.rejectedAt : null).toBe(
      'BUSINESS_VALIDATION',
    );
    expect(result.validation.business?.issues.map(({ code }) => code)).toEqual([
      QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_BUSINESS_RULE_COVERAGE,
    ]);
    expect(result.artifacts).toEqual([]);
    expect(result.metadata.generation).toBeNull();
    expect(provider.calls).toHaveLength(1);
  });

  it('reproduz a rejeição real de DOD incompleto e aceita a cobertura corrigida com FakeAIProvider', async () => {
    const validSpecification = createQASpecification();
    const invalidSpecification = createQASpecification({
      traceability: {
        ...validSpecification.traceability,
        matrix: [
          {
            ...validSpecification.traceability.matrix[0]!,
            technicalSourceIds:
              validSpecification.traceability.matrix[0]!.technicalSourceIds.filter(
                (id) => id !== 'DOD-001',
              ),
            scenarioIds: validSpecification.traceability.matrix[0]!.scenarioIds.filter(
              (id) => id !== 'QAE-001',
            ),
          },
        ],
      },
    });
    const { agent, provider } = await createHarness({
      outcomes: [
        { type: 'success', response: createQAAIResponse(invalidSpecification) },
        { type: 'success', response: createQAAIResponse(validSpecification) },
      ],
    });

    const rejected = await agent.execute(createQARequest());
    const generated = await agent.execute(createQARequest());

    expect(rejected.outcome).toBe('VALIDATION_REJECTED');
    expect(rejected.outcome === 'VALIDATION_REJECTED' ? rejected.rejectedAt : null).toBe(
      'BUSINESS_VALIDATION',
    );
    expect(rejected.validation.business?.issues.map(({ code }) => code)).toEqual([
      QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_DEFINITION_OF_DONE_COVERAGE,
      QA_BUSINESS_VALIDATION_ISSUE_CODES.COVERAGE_SUMMARY_MISMATCH,
    ]);
    expect(rejected.artifacts).toEqual([]);
    expect(generated.outcome).toBe('GENERATED');
    expect(generated.validation.business).toMatchObject({ valid: true, issues: [] });
    expect(generated.metadata.run.prompt.metadata.version).toBe('1.0.4');
    expect(provider.calls).toHaveLength(2);
  });

  it('rejeita category e readiness incoerentes sem retry ou autocorreção', async () => {
    const base = createQASpecification();
    const specification = createQASpecification({
      readiness: 'READY',
      openQuestions: [
        {
          id: 'QQ-001',
          question: 'Qual será o volume esperado em produção?',
          impact: 'NON_BLOCKING',
        },
      ],
      traceability: {
        ...base.traceability,
        functionalCoverage: [{ sourceId: 'AC-001', scenarioIds: ['QAN-001'] }],
      },
    });
    const { agent, provider } = await createHarness({
      outcomes: [{ type: 'success', response: createQAAIResponse(specification) }],
    });

    const result = await agent.execute(createQARequest());

    expect(result.outcome).toBe('VALIDATION_REJECTED');
    expect(result.outcome === 'VALIDATION_REJECTED' ? result.rejectedAt : null).toBe(
      'BUSINESS_VALIDATION',
    );
    expect(result.validation.business?.expectedReadiness).toBe('PARTIALLY_READY');
    expect(result.validation.business?.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        QA_BUSINESS_VALIDATION_ISSUE_CODES.CATEGORY_MISMATCH,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.READINESS_MISMATCH,
      ]),
    );
    expect(result.artifacts).toEqual([]);
    expect(result.metadata.generation).toBeNull();
    expect(provider.calls).toHaveLength(1);
  });

  it('rejeita duas associações de categoria incoerentes e aceita as relações corrigidas', async () => {
    const validSpecification = createQASpecification();
    const invalidSpecification = createQASpecification({
      traceability: {
        ...validSpecification.traceability,
        functionalCoverage: [{ sourceId: 'AC-001', scenarioIds: ['QAN-001'] }],
        technicalCoverage: [
          { sourceId: 'DEC-001', scenarioIds: ['QAE-001'] },
          validSpecification.traceability.technicalCoverage[1]!,
        ],
      },
    });
    const { agent, provider } = await createHarness({
      outcomes: [
        { type: 'success', response: createQAAIResponse(invalidSpecification) },
        { type: 'success', response: createQAAIResponse(validSpecification) },
      ],
    });

    const rejected = await agent.execute(createQARequest());
    const generated = await agent.execute(createQARequest());

    expect(rejected.outcome).toBe('VALIDATION_REJECTED');
    expect(rejected.outcome === 'VALIDATION_REJECTED' ? rejected.rejectedAt : null).toBe(
      'BUSINESS_VALIDATION',
    );
    expect(rejected.validation.business).toMatchObject({
      valid: false,
      expectedReadiness: 'READY',
      issues: [
        {
          code: QA_BUSINESS_VALIDATION_ISSUE_CODES.CATEGORY_MISMATCH,
          path: ['traceability', 'functionalCoverage', 0, 'scenarioIds'],
        },
        {
          code: QA_BUSINESS_VALIDATION_ISSUE_CODES.CATEGORY_MISMATCH,
          path: ['traceability', 'technicalCoverage', 0, 'scenarioIds'],
        },
      ],
    });
    expect(rejected.artifacts).toEqual([]);
    expect(generated.outcome).toBe('GENERATED');
    expect(generated.validation.business).toMatchObject({
      valid: true,
      expectedReadiness: 'READY',
      issues: [],
    });
    expect(generated.metadata.run.prompt.metadata.version).toBe('1.0.4');
    expect(generated.artifacts).toHaveLength(3);
    expect(provider.calls).toHaveLength(2);
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
