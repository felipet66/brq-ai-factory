import { createAgentRunner } from '@brq/agent-runner';
import { createArtifactGenerator, type ArtifactGenerator } from '@brq/artifact-generator';
import { createKnowledgeLoader, type KnowledgeLoader } from '@brq/knowledge-loader';
import { createPromptBuilder } from '@brq/prompt-builder';
import { createResponseValidator, type ResponseValidator } from '@brq/response-validator';
import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import {
  FakeAIProvider,
  type FakeAIProviderOutcome,
} from '../../core/ai-provider/fake/fake-ai-provider';
import { FakeKnowledgeSource } from '../../core/knowledge-loader/testing/fake-knowledge-source';
import { PRODUCT_OWNER_AGENT_ERROR_CODES, ProductOwnerAgentError } from './errors';
import { createProductOwnerAgent } from './product-owner-agent';
import { loadProductOwnerPromptAssets } from './prompt-assets';
import {
  createProductOwnerAIResponse,
  createProductOwnerRequest,
  createProductOwnerSpecification,
} from './testing/product-owner-fixtures';

const KNOWLEDGE_MANIFEST = {
  version: '1.0.0',
  documents: [
    {
      id: 'knowledge:product-owner-test',
      locator: 'product-owner.md',
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
    PRODUCT_OWNER: {
      required: ['knowledge:product-owner-test'],
      optional: [],
    },
    DEVELOPER: EMPTY_SELECTION,
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
      'product-owner.md': '# Product Owner\n\nUse linguagem funcional e explicite ambiguidades.',
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
        response: createProductOwnerAIResponse(createProductOwnerSpecification()),
      },
    ],
  );
  const agentRunner = createAgentRunner({
    promptBuilder: createPromptBuilder({ logger }),
    aiProvider: provider,
    logger,
  });
  const agent = createProductOwnerAgent({
    knowledgeLoader: options.knowledgeLoader ?? defaultKnowledgeLoader,
    agentRunner,
    responseValidator: options.responseValidator ?? createResponseValidator({ logger }),
    artifactGenerator: options.artifactGenerator ?? createArtifactGenerator({ logger }),
    promptAssets: loadProductOwnerPromptAssets(),
    logger,
  });

  return { agent, logLines, provider, source };
}

describe('ProductOwnerAgent', () => {
  it('executa o pipeline real uma vez e produz os três drafts canônicos', async () => {
    const { agent, provider } = await createHarness();
    const controller = new AbortController();
    const request = createProductOwnerRequest();
    const requestSnapshot = structuredClone(request);
    const result = await agent.execute(request, { signal: controller.signal });

    expect(result.outcome).toBe('GENERATED');
    expect(result.readiness).toBe('READY');
    expect(result.specification?.title).toBe('Consulta de pedidos');
    expect(result.artifacts.map((artifact) => artifact.draft.filename)).toEqual([
      'story.md',
      'acceptance.md',
      'backlog.json',
    ]);
    expect(result.artifacts[0]?.draft.content).toContain('# Consulta de pedidos');
    expect(JSON.parse(result.artifacts[2]!.draft.content)).toEqual(
      result.specification?.backlogItems,
    );
    expect(result.metadata.generation?.artifactCount).toBe(3);
    expect(result.metadata.assets.bundleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.metadata.knowledge.context).toBe('PRODUCT_OWNER');
    expect(result.metadata.run.prompt.metadata.agent).toBe('PRODUCT_OWNER');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.options.signal).toBe(controller.signal);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.artifacts)).toBe(true);
    expect(Object.isFrozen(result.specification)).toBe(true);
    expect(request).toEqual(requestSnapshot);
    expect(Object.isFrozen(request)).toBe(false);
  });

  it('preserva hashes e drafts determinísticos para a mesma entrada explícita', async () => {
    const specification = createProductOwnerSpecification();
    const response = createProductOwnerAIResponse(specification);
    const { agent, provider } = await createHarness({
      outcomes: [
        { type: 'success', response },
        { type: 'success', response: structuredClone(response) },
      ],
    });
    const request = createProductOwnerRequest();

    const first = await agent.execute(request);
    const second = await agent.execute(structuredClone(request));

    expect(first.outcome).toBe('GENERATED');
    expect(second.outcome).toBe('GENERATED');
    expect(first.metadata.run.prompt.metadata.promptHash).toBe(
      second.metadata.run.prompt.metadata.promptHash,
    );
    expect(first.metadata.assets.bundleHash).toBe(second.metadata.assets.bundleHash);
    expect(first.artifacts).toEqual(second.artifacts);
    expect(first.metadata.generation?.generationHash).toBe(
      second.metadata.generation?.generationHash,
    );
    expect(provider.calls).toHaveLength(2);
  });

  it('produz PARTIALLY_READY quando uma premissa ainda exige validação', async () => {
    const specification = createProductOwnerSpecification({
      readiness: 'PARTIALLY_READY',
      assumptions: [
        {
          id: 'ASM-001',
          description: 'A situação do pedido está disponível para consulta.',
          requiresValidation: true,
        },
      ],
    });
    const { agent } = await createHarness({
      outcomes: [{ type: 'success', response: createProductOwnerAIResponse(specification) }],
    });

    const result = await agent.execute(createProductOwnerRequest());

    expect(result.outcome).toBe('GENERATED');
    expect(result.readiness).toBe('PARTIALLY_READY');
  });

  it('produz REQUIRES_CLARIFICATION e ainda gera drafts para pergunta bloqueante', async () => {
    const specification = createProductOwnerSpecification({
      readiness: 'REQUIRES_CLARIFICATION',
      userStory: null,
      acceptanceCriteria: [],
      scenarios: [],
      definitionOfReady: [],
      backlogItems: [],
      openQuestions: [
        {
          id: 'Q-001',
          question: 'Qual sistema fornece o andamento do pedido?',
          impact: 'BLOCKING',
        },
      ],
    });
    const { agent } = await createHarness({
      outcomes: [{ type: 'success', response: createProductOwnerAIResponse(specification) }],
    });

    const result = await agent.execute(createProductOwnerRequest());

    expect(result.outcome).toBe('GENERATED');
    expect(result.readiness).toBe('REQUIRES_CLARIFICATION');
    expect(result.artifacts).toHaveLength(3);
  });

  it('rejeita pela Business Validation sem gerar artifacts nem executar retry', async () => {
    const specification = createProductOwnerSpecification({
      readiness: 'READY',
      openQuestions: [
        {
          id: 'Q-001',
          question: 'A consulta precisa estar disponível fora do horário comercial?',
          impact: 'NON_BLOCKING',
        },
      ],
    });
    const { agent, provider } = await createHarness({
      outcomes: [{ type: 'success', response: createProductOwnerAIResponse(specification) }],
    });

    const result = await agent.execute(createProductOwnerRequest());

    expect(result.outcome).toBe('VALIDATION_REJECTED');
    expect(result.outcome === 'VALIDATION_REJECTED' ? result.rejectedAt : null).toBe(
      'BUSINESS_VALIDATION',
    );
    expect(result.artifacts).toEqual([]);
    expect(result.validation.business?.issues.map((issue) => issue.code)).toContain(
      'PRODUCT_OWNER_READINESS_MISMATCH',
    );
    expect(provider.calls).toHaveLength(1);
  });

  it.each([
    ['JSON malformado', { type: 'malformed_json' }],
    ['schema incompatível', { type: 'incompatible_structured_output' }],
    [
      'refusal',
      {
        type: 'success',
        response: createProductOwnerAIResponse(createProductOwnerSpecification(), {
          finishReason: 'REFUSAL',
        }),
      },
    ],
    [
      'content filter',
      {
        type: 'success',
        response: createProductOwnerAIResponse(createProductOwnerSpecification(), {
          finishReason: 'CONTENT_FILTER',
        }),
      },
    ],
    [
      'max output tokens',
      {
        type: 'success',
        response: createProductOwnerAIResponse(createProductOwnerSpecification(), {
          finishReason: 'MAX_OUTPUT_TOKENS',
        }),
      },
    ],
  ] satisfies readonly (readonly [string, FakeAIProviderOutcome])[])(
    'retorna rejeição funcional para %s',
    async (_label, outcome) => {
      const { agent, provider } = await createHarness({ outcomes: [outcome] });

      const result = await agent.execute(createProductOwnerRequest());

      expect(result.outcome).toBe('VALIDATION_REJECTED');
      expect(result.outcome === 'VALIDATION_REJECTED' ? result.rejectedAt : null).toBe(
        'RESPONSE_VALIDATION',
      );
      expect(result.artifacts).toEqual([]);
      expect(provider.calls).toHaveLength(1);
    },
  );

  it.each([
    ['timeout', { type: 'timeout' }, PRODUCT_OWNER_AGENT_ERROR_CODES.TIMEOUT],
    ['cancelamento do provider', { type: 'cancelled' }, PRODUCT_OWNER_AGENT_ERROR_CODES.CANCELLED],
    [
      'provider indisponível',
      { type: 'permanent_failure' },
      PRODUCT_OWNER_AGENT_ERROR_CODES.RUN_FAILED,
    ],
  ] satisfies readonly (readonly [string, FakeAIProviderOutcome, string])[])(
    'traduz %s como erro técnico e não executa retry',
    async (_label, outcome, expectedCode) => {
      const { agent, provider } = await createHarness({ outcomes: [outcome] });

      await expect(agent.execute(createProductOwnerRequest())).rejects.toMatchObject({
        name: 'ProductOwnerAgentError',
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

    await expect(agent.execute(createProductOwnerRequest())).rejects.toMatchObject({
      code: PRODUCT_OWNER_AGENT_ERROR_CODES.KNOWLEDGE_LOAD_FAILED,
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

    await expect(agent.execute(createProductOwnerRequest())).rejects.toMatchObject({
      code: PRODUCT_OWNER_AGENT_ERROR_CODES.VALIDATION_FAILED,
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

    await expect(agent.execute(createProductOwnerRequest())).rejects.toMatchObject({
      code: PRODUCT_OWNER_AGENT_ERROR_CODES.ARTIFACT_GENERATION_FAILED,
      stage: 'ARTIFACT_GENERATION',
      sourceCode: 'ARTIFACT_GENERATOR_INTERNAL_ERROR',
    });
    expect(provider.calls).toHaveLength(1);
  });

  it('rejeita configuração ou bundle adulterado antes de criar a fachada', () => {
    expect(() =>
      createProductOwnerAgent({
        knowledgeLoader: null as never,
        agentRunner: null as never,
        responseValidator: null as never,
        artifactGenerator: null as never,
        promptAssets: loadProductOwnerPromptAssets(),
      }),
    ).toThrowError(
      expect.objectContaining({ code: PRODUCT_OWNER_AGENT_ERROR_CODES.INVALID_CONFIGURATION }),
    );

    const assets = loadProductOwnerPromptAssets();
    const tamperedAssets = {
      ...assets,
      hashes: { ...assets.hashes, bundleHash: '0'.repeat(64) },
    };
    const unreachable = async (): Promise<never> => {
      throw new Error('não deve executar');
    };

    expect(() =>
      createProductOwnerAgent({
        knowledgeLoader: { getIndex: () => unreachable() as never, load: unreachable },
        agentRunner: { run: unreachable },
        responseValidator: { validate: () => unreachable() as never },
        artifactGenerator: { generate: () => unreachable() as never },
        promptAssets: tamperedAssets,
      }),
    ).toThrowError(
      expect.objectContaining({ code: PRODUCT_OWNER_AGENT_ERROR_CODES.INVALID_PROMPT_ASSETS }),
    );
  });

  it('interrompe antes de carregar conhecimento quando o signal já está cancelado', async () => {
    const { agent, provider, source } = await createHarness();
    const readsBeforeExecution = source.readCalls.length;
    const controller = new AbortController();
    controller.abort();

    await expect(
      agent.execute(createProductOwnerRequest(), { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'ProductOwnerAgentError',
      code: PRODUCT_OWNER_AGENT_ERROR_CODES.CANCELLED,
      stage: 'REQUEST_VALIDATION',
    });
    expect(source.readCalls).toHaveLength(readsBeforeExecution);
    expect(provider.calls).toHaveLength(0);
  });

  it('rejeita request inválido antes das dependências e não expõe payload na mensagem', async () => {
    const { agent, provider, source } = await createHarness();
    const readsBeforeExecution = source.readCalls.length;
    const secret = 'segredo-na-demanda';

    const promise = agent.execute({
      ...createProductOwnerRequest(),
      demand: { title: '', description: secret },
    });

    await expect(promise).rejects.toBeInstanceOf(ProductOwnerAgentError);
    await expect(promise).rejects.toMatchObject({
      code: PRODUCT_OWNER_AGENT_ERROR_CODES.INVALID_REQUEST,
      stage: 'REQUEST_VALIDATION',
    });
    await promise.catch((error: ProductOwnerAgentError) => {
      expect(error.message).not.toContain(secret);
    });
    expect(source.readCalls).toHaveLength(readsBeforeExecution);
    expect(provider.calls).toHaveLength(0);
  });

  it('registra somente metadados na fachada', async () => {
    const { agent, logLines } = await createHarness();
    const request = createProductOwnerRequest({
      additionalContext: 'CONTEUDO_ADICIONAL_SECRETO',
      demand: {
        title: 'TITULO_NAO_DEVE_IR_AO_LOG',
        description: 'DESCRICAO_NAO_DEVE_IR_AO_LOG',
      },
    });

    await agent.execute(request);

    const facadeLogs = logLines.filter((line) => line.includes('product_owner.'));
    expect(facadeLogs.some((line) => line.includes('product_owner.agent.started'))).toBe(true);
    expect(facadeLogs.some((line) => line.includes('product_owner.agent.completed'))).toBe(true);
    expect(facadeLogs.join('\n')).not.toContain('TITULO_NAO_DEVE_IR_AO_LOG');
    expect(facadeLogs.join('\n')).not.toContain('DESCRICAO_NAO_DEVE_IR_AO_LOG');
    expect(facadeLogs.join('\n')).not.toContain('CONTEUDO_ADICIONAL_SECRETO');
    expect(facadeLogs.join('\n')).not.toContain('Use linguagem funcional');
    expect(facadeLogs.join('\n')).not.toContain('Consulta de pedidos');
  });
});
