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
import { createProductOwnerSpecification } from '../product-owner/testing/product-owner-fixtures';
import { DEVELOPER_AGENT_ERROR_CODES, DeveloperAgentError } from './errors';
import { createDeveloperAgent } from './developer-agent';
import { loadDeveloperPromptAssets } from './prompt-assets';
import {
  createDeveloperAIResponse,
  createDeveloperRequest,
  createTechnicalSpecification,
} from './testing/developer-fixtures';

const KNOWLEDGE_MANIFEST = {
  version: '1.0.0',
  documents: [
    {
      id: 'knowledge:developer-test',
      locator: 'developer.md',
      category: 'AGENT',
      order: 1,
    },
  ],
} as const;

const EMPTY_SELECTION = { required: [], optional: [] } as const;
const KNOWLEDGE_POLICY = {
  version: '1.0.0',
  contexts: {
    GLOBAL: EMPTY_SELECTION,
    PRODUCT_OWNER: EMPTY_SELECTION,
    DEVELOPER: {
      required: ['knowledge:developer-test'],
      optional: [],
    },
    QA: EMPTY_SELECTION,
    CODE_GENERATOR: EMPTY_SELECTION,
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
    documents: {
      'developer.md': '# Developer\n\nProduza somente uma especificação técnica declarativa.',
    },
  });
  const defaultKnowledgeLoader = await createKnowledgeLoader({
    source,
    manifest: KNOWLEDGE_MANIFEST,
    policy: KNOWLEDGE_POLICY,
    logger,
  });
  const provider = new FakeAIProvider(
    options.outcomes ?? [
      {
        type: 'success',
        response: createDeveloperAIResponse(createTechnicalSpecification()),
      },
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
  const agent = createDeveloperAgent({
    knowledgeLoader: options.knowledgeLoader ?? defaultKnowledgeLoader,
    agentRunner,
    responseValidator: options.responseValidator ?? createResponseValidator({ logger }),
    artifactGenerator: options.artifactGenerator ?? createArtifactGenerator({ logger }),
    promptAssets: loadDeveloperPromptAssets(),
    logger,
  });

  return { agent, logLines, provider, source };
}

describe('DeveloperAgent', () => {
  it('accepts greenfield components and modules declared with CREATE', async () => {
    const base = createTechnicalSpecification();
    const specification = createTechnicalSpecification({
      components: base.components.map((component) => ({
        ...component,
        changeType: 'CREATE',
      })),
      modules: base.modules.map((module) => ({ ...module, changeType: 'CREATE' })),
    });
    const { agent, provider } = await createHarness({
      outcomes: [{ type: 'success', response: createDeveloperAIResponse(specification) }],
    });

    const result = await agent.execute(createDeveloperRequest());

    expect(result).toMatchObject({ outcome: 'GENERATED', readiness: 'READY' });
    expect(
      result.specification?.components.every(({ changeType }) => changeType === 'CREATE'),
    ).toBe(true);
    expect(result.specification?.modules.every(({ changeType }) => changeType === 'CREATE')).toBe(
      true,
    );
    expect(provider.calls).toHaveLength(1);
  });

  it('rejects non-CREATE output in GREENFIELD and preserves it in CHANGE', async () => {
    const base = createTechnicalSpecification();
    const specification = createTechnicalSpecification({
      components: base.components.map((component) => ({
        ...component,
        changeType: 'MODIFY' as const,
      })),
      modules: base.modules.map((module) => ({
        ...module,
        changeType: 'DELETE' as const,
      })),
    });
    const response = createDeveloperAIResponse(specification);
    const greenfield = await createHarness({ outcomes: [{ type: 'success', response }] });

    const rejected = await greenfield.agent.execute(
      createDeveloperRequest({ deliveryIntent: GREENFIELD_DELIVERY_INTENT }),
    );
    expect(rejected).toMatchObject({
      outcome: 'VALIDATION_REJECTED',
      rejectedAt: 'BUSINESS_VALIDATION',
    });
    expect(rejected.validation.business?.issues.map(({ code }) => code)).toContain(
      'DEVELOPER_CHANGE_TYPE_NOT_ALLOWED',
    );

    const change = await createHarness({
      outcomes: [{ type: 'success', response: structuredClone(response) }],
    });
    const generated = await change.agent.execute(
      createDeveloperRequest({ deliveryIntent: CHANGE_DELIVERY_INTENT }),
    );
    expect(generated).toMatchObject({ outcome: 'GENERATED', specification });
  });

  it('executa o pipeline real uma vez e produz os três drafts técnicos canônicos', async () => {
    const { agent, provider } = await createHarness();
    const controller = new AbortController();
    const request = createDeveloperRequest();
    const requestSnapshot = structuredClone(request);
    const result = await agent.execute(request, {
      signal: controller.signal,
      cacheMode: 'REQUIRE_HIT',
      sourceExecutionId: request.context.executionId,
    });

    expect(result.outcome).toBe('GENERATED');
    expect(result.readiness).toBe('READY');
    expect(result.specification?.complexity).toBe('MEDIUM');
    expect(result.specification?.estimatedStoryPoints).toBe(13);
    expect(result.specification?.implementationPhases).toHaveLength(1);
    expect(result.artifacts.map((artifact) => artifact.draft.filename)).toEqual([
      'architecture.md',
      'implementation-plan.md',
      'technical-decisions.json',
    ]);
    expect(result.artifacts[0]?.draft.content).toContain(
      '# Arquitetura técnica — Arquitetura da consulta de pedidos',
    );
    expect(JSON.parse(result.artifacts[2]!.draft.content)).toEqual(result.specification?.decisions);
    expect(result.metadata.generation?.artifactCount).toBe(3);
    expect(result.metadata.assets.bundleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.metadata.knowledge.context).toBe('DEVELOPER');
    expect(result.metadata.run.prompt.metadata.agent).toBe('DEVELOPER');
    expect(result.metadata.sourceReadiness).toBe('READY');
    expect(result.metadata.sourceSpecificationHash).toBe(
      `sha256:${calculateCanonicalJsonHash(
        request.productOwnerSpecification as unknown as JsonValue,
      )}`,
    );
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.options.signal).toBe(controller.signal);
    expect(provider.calls[0]?.options.cacheMode).toBe('REQUIRE_HIT');
    expect(provider.calls[0]?.options.sourceExecutionId).toBe(request.context.executionId);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.artifacts)).toBe(true);
    expect(Object.isFrozen(result.specification)).toBe(true);
    expect(request).toEqual(requestSnapshot);
    expect(Object.isFrozen(request)).toBe(false);
  });

  it('preserva hashes e drafts determinísticos para a mesma entrada explícita', async () => {
    const specification = createTechnicalSpecification();
    const response = createDeveloperAIResponse(specification);
    const { agent, provider } = await createHarness({
      outcomes: [
        { type: 'success', response },
        { type: 'success', response: structuredClone(response) },
      ],
    });
    const request = createDeveloperRequest();

    const first = await agent.execute(request);
    const second = await agent.execute(structuredClone(request));

    expect(first.outcome).toBe('GENERATED');
    expect(second.outcome).toBe('GENERATED');
    expect(first.metadata.run.prompt.metadata.promptHash).toBe(
      second.metadata.run.prompt.metadata.promptHash,
    );
    expect(first.metadata.sourceSpecificationHash).toBe(second.metadata.sourceSpecificationHash);
    expect(first.artifacts).toEqual(second.artifacts);
    expect(first.metadata.generation?.generationHash).toBe(
      second.metadata.generation?.generationHash,
    );
    expect(provider.calls).toHaveLength(2);
  });

  it('herda PARTIALLY_READY da specification funcional', async () => {
    const productOwnerSpecification = createProductOwnerSpecification({
      readiness: 'PARTIALLY_READY',
      openQuestions: [
        {
          id: 'Q-001',
          question: 'A consulta precisa estar disponível fora do horário comercial?',
          impact: 'NON_BLOCKING',
        },
      ],
    });
    const technicalSpecification = createTechnicalSpecification({
      readiness: 'PARTIALLY_READY',
    });
    const { agent } = await createHarness({
      outcomes: [{ type: 'success', response: createDeveloperAIResponse(technicalSpecification) }],
    });

    const result = await agent.execute(createDeveloperRequest({ productOwnerSpecification }));

    expect(result.outcome).toBe('GENERATED');
    expect(result.readiness).toBe('PARTIALLY_READY');
    expect(result.metadata.sourceReadiness).toBe('PARTIALLY_READY');
  });

  it('produz PARTIALLY_READY para dúvida técnica não bloqueante sem retry ou autocorreção', async () => {
    const specification = createTechnicalSpecification({
      readiness: 'PARTIALLY_READY',
      openQuestions: [
        {
          id: 'TQ-001',
          question: 'A retenção local deverá ser configurável futuramente?',
          impact: 'NON_BLOCKING',
        },
      ],
    });
    const { agent, provider } = await createHarness({
      outcomes: [{ type: 'success', response: createDeveloperAIResponse(specification) }],
    });

    const result = await agent.execute(createDeveloperRequest());

    expect(result.outcome).toBe('GENERATED');
    expect(result.readiness).toBe('PARTIALLY_READY');
    expect(result.specification?.openQuestions).toEqual(specification.openQuestions);
    expect(result.artifacts).toHaveLength(3);
    expect(provider.calls).toHaveLength(1);
  });

  it('produz REQUIRES_CLARIFICATION para dúvida técnica bloqueante sem corrigir a saída', async () => {
    const specification = createTechnicalSpecification({
      readiness: 'REQUIRES_CLARIFICATION',
      openQuestions: [
        {
          id: 'TQ-001',
          question: 'Qual sistema fornece o andamento do pedido?',
          impact: 'BLOCKING',
        },
      ],
    });
    const { agent } = await createHarness({
      outcomes: [{ type: 'success', response: createDeveloperAIResponse(specification) }],
    });

    const result = await agent.execute(createDeveloperRequest());

    expect(result.outcome).toBe('GENERATED');
    expect(result.readiness).toBe('REQUIRES_CLARIFICATION');
    expect(result.specification?.openQuestions).toEqual(specification.openQuestions);
  });

  it('rejeita pela Business Validation quando um Acceptance Criterion não possui cobertura', async () => {
    const productOwnerSpecification = createProductOwnerSpecification({
      acceptanceCriteria: [
        {
          id: 'AC-001',
          given: 'que o cliente possui um pedido nacional',
          when: 'ele consulta o pedido',
          then: 'o andamento atual é apresentado',
        },
        {
          id: 'AC-002',
          given: 'que o pedido não existe',
          when: 'ele consulta o pedido',
          then: 'uma resposta de ausência é apresentada',
        },
      ],
    });
    const specification = createTechnicalSpecification();
    const { agent, provider } = await createHarness({
      outcomes: [{ type: 'success', response: createDeveloperAIResponse(specification) }],
    });

    const result = await agent.execute(createDeveloperRequest({ productOwnerSpecification }));

    expect(result.outcome).toBe('VALIDATION_REJECTED');
    expect(result.outcome === 'VALIDATION_REJECTED' ? result.rejectedAt : null).toBe(
      'BUSINESS_VALIDATION',
    );
    expect(result.validation.business?.issues.map((issue) => issue.code)).toContain(
      'DEVELOPER_MISSING_ACCEPTANCE_CRITERION_COVERAGE',
    );
    expect(result.artifacts).toEqual([]);
    expect(provider.calls).toHaveLength(1);
  });

  it('permite que o mesmo Acceptance Criterion rastreie mais de um destino técnico', async () => {
    const base = createTechnicalSpecification();
    const specification = createTechnicalSpecification({
      traceability: [
        ...base.traceability,
        {
          id: 'TRC-002',
          sourceIds: ['AC-001'],
          componentIds: [],
          moduleIds: [],
          flowIds: [],
          contractIds: [],
          apiIds: ['API-001'],
          eventIds: [],
          implementationPlanIds: [],
          technicalBacklogIds: [],
          definitionOfDoneIds: [],
        },
      ],
    });
    const { agent } = await createHarness({
      outcomes: [{ type: 'success', response: createDeveloperAIResponse(specification) }],
    });

    const result = await agent.execute(createDeveloperRequest());

    expect(result.outcome).toBe('GENERATED');
  });

  it('rejeita readiness incoerente sem gerar artifacts ou retry', async () => {
    const specification = createTechnicalSpecification({
      readiness: 'READY',
      assumptions: [
        {
          id: 'TASM-001',
          description: 'A origem do andamento expõe o contrato esperado.',
          requiresValidation: true,
        },
      ],
    });
    const { agent, provider } = await createHarness({
      outcomes: [{ type: 'success', response: createDeveloperAIResponse(specification) }],
    });

    const result = await agent.execute(createDeveloperRequest());

    expect(result.outcome).toBe('VALIDATION_REJECTED');
    expect(result.outcome === 'VALIDATION_REJECTED' ? result.rejectedAt : null).toBe(
      'BUSINESS_VALIDATION',
    );
    expect(result.validation.business?.issues.map((issue) => issue.code)).toContain(
      'DEVELOPER_READINESS_MISMATCH',
    );
    expect(result.artifacts).toEqual([]);
    expect(provider.calls).toHaveLength(1);
  });

  it.each([
    ['JSON malformado', { type: 'malformed_json' }],
    ['schema incompatível', { type: 'incompatible_structured_output' }],
    [
      'refusal',
      {
        type: 'success',
        response: createDeveloperAIResponse(createTechnicalSpecification(), {
          finishReason: 'REFUSAL',
        }),
      },
    ],
    [
      'content filter',
      {
        type: 'success',
        response: createDeveloperAIResponse(createTechnicalSpecification(), {
          finishReason: 'CONTENT_FILTER',
        }),
      },
    ],
    [
      'max output tokens',
      {
        type: 'success',
        response: createDeveloperAIResponse(createTechnicalSpecification(), {
          finishReason: 'MAX_OUTPUT_TOKENS',
        }),
      },
    ],
  ] satisfies readonly (readonly [string, FakeAIProviderOutcome])[])(
    'retorna rejeição funcional para %s',
    async (_label, outcome) => {
      const { agent, provider } = await createHarness({ outcomes: [outcome] });

      const result = await agent.execute(createDeveloperRequest());

      expect(result.outcome).toBe('VALIDATION_REJECTED');
      expect(result.outcome === 'VALIDATION_REJECTED' ? result.rejectedAt : null).toBe(
        'RESPONSE_VALIDATION',
      );
      expect(result.artifacts).toEqual([]);
      expect(provider.calls).toHaveLength(1);
    },
  );

  it.each([
    ['timeout', { type: 'timeout' }, DEVELOPER_AGENT_ERROR_CODES.TIMEOUT],
    ['cancelamento do provider', { type: 'cancelled' }, DEVELOPER_AGENT_ERROR_CODES.CANCELLED],
    ['falha transitória', { type: 'transient_failure' }, DEVELOPER_AGENT_ERROR_CODES.RUN_FAILED],
    [
      'provider indisponível',
      { type: 'permanent_failure' },
      DEVELOPER_AGENT_ERROR_CODES.RUN_FAILED,
    ],
  ] satisfies readonly (readonly [string, FakeAIProviderOutcome, string])[])(
    'traduz %s como erro técnico e não executa retry',
    async (_label, outcome, expectedCode) => {
      const { agent, provider } = await createHarness({ outcomes: [outcome] });

      await expect(agent.execute(createDeveloperRequest())).rejects.toMatchObject({
        name: 'DeveloperAgentError',
        code: expectedCode,
        stage: 'RUNNER_EXECUTION',
      });
      expect(provider.calls).toHaveLength(1);
    },
  );

  it('traduz falha do Knowledge Loader sem iniciar o Runner', async () => {
    const failure = Object.assign(new Error('conteúdo interno não deve ser exposto'), {
      code: 'KNOWLEDGE_READ_FAILED',
    });
    const knowledgeLoader: KnowledgeLoader = {
      getIndex: () => {
        throw failure;
      },
      load: async () => {
        throw failure;
      },
    };
    const { agent, provider } = await createHarness({ knowledgeLoader });

    await expect(agent.execute(createDeveloperRequest())).rejects.toMatchObject({
      code: DEVELOPER_AGENT_ERROR_CODES.KNOWLEDGE_LOAD_FAILED,
      stage: 'KNOWLEDGE_LOADING',
      sourceCode: 'KNOWLEDGE_READ_FAILED',
    });
    expect(provider.calls).toHaveLength(0);
  });

  it('traduz falha técnica do Response Validator sem gerar artifacts', async () => {
    const responseValidator: ResponseValidator = {
      validate: () => {
        throw Object.assign(new Error('falha interna'), {
          code: 'RESPONSE_VALIDATOR_INTERNAL_ERROR',
        });
      },
    };
    const { agent, provider } = await createHarness({ responseValidator });

    await expect(agent.execute(createDeveloperRequest())).rejects.toMatchObject({
      code: DEVELOPER_AGENT_ERROR_CODES.VALIDATION_FAILED,
      stage: 'RESPONSE_VALIDATION',
      sourceCode: 'RESPONSE_VALIDATOR_INTERNAL_ERROR',
    });
    expect(provider.calls).toHaveLength(1);
  });

  it('traduz falha do Artifact Generator após as duas validações', async () => {
    const artifactGenerator: ArtifactGenerator = {
      generate: () => {
        throw Object.assign(new Error('falha interna'), {
          code: 'ARTIFACT_GENERATOR_INTERNAL_ERROR',
        });
      },
    };
    const { agent, provider } = await createHarness({ artifactGenerator });

    await expect(agent.execute(createDeveloperRequest())).rejects.toMatchObject({
      code: DEVELOPER_AGENT_ERROR_CODES.ARTIFACT_GENERATION_FAILED,
      stage: 'ARTIFACT_GENERATION',
      sourceCode: 'ARTIFACT_GENERATOR_INTERNAL_ERROR',
    });
    expect(provider.calls).toHaveLength(1);
  });

  it('rejeita configuração ou bundle adulterado antes de criar a fachada', () => {
    expect(() =>
      createDeveloperAgent({
        knowledgeLoader: null as never,
        agentRunner: null as never,
        responseValidator: null as never,
        artifactGenerator: null as never,
        promptAssets: loadDeveloperPromptAssets(),
      }),
    ).toThrowError(
      expect.objectContaining({ code: DEVELOPER_AGENT_ERROR_CODES.INVALID_CONFIGURATION }),
    );

    const assets = loadDeveloperPromptAssets();
    const tamperedAssets = {
      ...assets,
      hashes: { ...assets.hashes, bundleHash: '0'.repeat(64) },
    };
    const unreachable = async (): Promise<never> => {
      throw new Error('não deve executar');
    };

    expect(() =>
      createDeveloperAgent({
        knowledgeLoader: { getIndex: () => unreachable() as never, load: unreachable },
        agentRunner: { run: unreachable },
        responseValidator: { validate: () => unreachable() as never },
        artifactGenerator: { generate: () => unreachable() as never },
        promptAssets: tamperedAssets,
      }),
    ).toThrowError(
      expect.objectContaining({ code: DEVELOPER_AGENT_ERROR_CODES.INVALID_PROMPT_ASSETS }),
    );
  });

  it('interrompe antes de carregar conhecimento quando o signal já está cancelado', async () => {
    const { agent, provider, source } = await createHarness();
    const readsBeforeExecution = source.readCalls.length;
    const controller = new AbortController();
    controller.abort();

    await expect(
      agent.execute(createDeveloperRequest(), { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'DeveloperAgentError',
      code: DEVELOPER_AGENT_ERROR_CODES.CANCELLED,
      stage: 'REQUEST_VALIDATION',
    });
    expect(source.readCalls).toHaveLength(readsBeforeExecution);
    expect(provider.calls).toHaveLength(0);
  });

  it('rejeita request inválido antes das dependências e não expõe conteúdo funcional', async () => {
    const { agent, provider, source } = await createHarness();
    const readsBeforeExecution = source.readCalls.length;
    const secret = 'segredo-na-specification';
    const request = createDeveloperRequest();
    const promise = agent.execute({
      ...request,
      productOwnerSpecification: {
        ...request.productOwnerSpecification,
        summary: secret,
        title: '',
      },
    });

    await expect(promise).rejects.toBeInstanceOf(DeveloperAgentError);
    await expect(promise).rejects.toMatchObject({
      code: DEVELOPER_AGENT_ERROR_CODES.INVALID_REQUEST,
      stage: 'REQUEST_VALIDATION',
    });
    await promise.catch((error: DeveloperAgentError) => {
      expect(error.message).not.toContain(secret);
    });
    expect(source.readCalls).toHaveLength(readsBeforeExecution);
    expect(provider.calls).toHaveLength(0);
  });

  it('encaminha limites técnicos ao Runner sem criar timeout próprio', async () => {
    const { agent, provider } = await createHarness();

    const result = await agent.execute(
      createDeveloperRequest({
        limits: {
          knowledgeMaxDocuments: 2,
          knowledgeMaxBytes: 20_000,
          promptMaxBytes: 100_000,
          maxOutputTokens: 2_048,
          timeoutMs: 12_345,
        },
      }),
    );

    expect(result.metadata.knowledge.budget.maxDocuments).toBe(2);
    expect(result.metadata.knowledge.budget.maxBytes).toBe(20_000);
    expect(result.metadata.run.prompt.budget.maxBytes).toBe(100_000);
    expect(provider.calls[0]?.request.maxOutputTokens).toBe(2_048);
    expect(provider.calls[0]?.options.timeoutMs).toBe(12_345);
    expect(provider.calls).toHaveLength(1);
  });

  it('registra somente metadados na fachada', async () => {
    const secret = 'CONTEUDO_FUNCIONAL_SECRETO';
    const productOwnerSpecification = createProductOwnerSpecification({ summary: secret });
    const { agent, logLines } = await createHarness();

    await agent.execute(createDeveloperRequest({ productOwnerSpecification }));

    const facadeLogs = logLines.filter((line) => line.includes('developer.'));
    expect(facadeLogs.some((line) => line.includes('developer.agent.started'))).toBe(true);
    expect(facadeLogs.some((line) => line.includes('developer.agent.completed'))).toBe(true);
    expect(facadeLogs.join('\n')).not.toContain(secret);
    expect(facadeLogs.join('\n')).not.toContain('Produza somente uma especificação técnica');
    expect(facadeLogs.join('\n')).not.toContain('Arquitetura da consulta de pedidos');
  });
});
