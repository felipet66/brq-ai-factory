import { AGENT_RUN_ERROR_CODES, AgentRunError, type AgentRunRequest } from '@brq/agent-runner';
import { createArtifactGenerator } from '@brq/artifact-generator';
import { createKnowledgeLoader } from '@brq/knowledge-loader';
import {
  PROMPT_BUILDER_ERROR_CODES,
  PromptBuilderError,
  createPromptBuilder,
  type PromptBuildInput,
  type PromptBuildOptions,
  type PromptBuilder,
} from '@brq/prompt-builder';
import { createResponseValidator } from '@brq/response-validator';
import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import { FakeKnowledgeSource } from '../../core/knowledge-loader/testing/fake-knowledge-source';
import { createTechnicalSpecification } from '../developer/testing/developer-fixtures';
import { createProductOwnerSpecification } from '../product-owner/testing/product-owner-fixtures';
import { validateQABusinessRules } from './business-validation';
import { compileCanonicalQASpecification } from './canonical-qa-compiler';
import { createDeterministicQAAgentRunner } from './deterministic-agent-runner';
import { createDeterministicQAAgent } from './deterministic-qa-agent';
import { projectQAPromptContexts } from './knowledge-projection';
import { loadQAPromptAssets } from './prompt-assets';
import { createQAAgentRunRequest } from './prompt-request';
import { qaAgentResultSchema, qaSpecificationSchema } from './schemas';
import { createQARequest } from './testing/qa-fixtures';

const EMPTY_SELECTION = { required: [], optional: [] } as const;
const KNOWLEDGE_MANIFEST = {
  version: '1.0.0',
  documents: [{ id: 'knowledge:qa-deterministic', locator: 'qa.md', category: 'AGENT', order: 1 }],
} as const;
const KNOWLEDGE_POLICY = {
  version: '1.0.0',
  contexts: {
    GLOBAL: EMPTY_SELECTION,
    PRODUCT_OWNER: EMPTY_SELECTION,
    DEVELOPER: EMPTY_SELECTION,
    QA: { required: ['knowledge:qa-deterministic'], optional: [] },
    CODE_GENERATOR: EMPTY_SELECTION,
    SECURITY: EMPTY_SELECTION,
    ARCHITECTURE: EMPTY_SELECTION,
  },
} as const;

async function createKnowledgeLoaderForTest() {
  return createKnowledgeLoader({
    source: new FakeKnowledgeSource({
      documents: { 'qa.md': '# QA\n\nUse os contratos e regras versionados.' },
    }),
    manifest: KNOWLEDGE_MANIFEST,
    policy: KNOWLEDGE_POLICY,
  });
}

function countingPromptBuilder() {
  const delegate = createPromptBuilder();
  let calls = 0;
  const promptBuilder: PromptBuilder = Object.freeze({
    build(input: PromptBuildInput, options?: PromptBuildOptions) {
      calls += 1;
      return delegate.build(input, options);
    },
  });
  return { promptBuilder, calls: () => calls };
}

async function createDeterministicHarness() {
  const logLines: string[] = [];
  const logger = createLogger({ sink: (line) => logLines.push(line) });
  const prompt = countingPromptBuilder();
  const agent = createDeterministicQAAgent({
    knowledgeLoader: await createKnowledgeLoaderForTest(),
    promptBuilder: prompt.promptBuilder,
    responseValidator: createResponseValidator({ logger }),
    artifactGenerator: createArtifactGenerator({ logger }),
    promptAssets: loadQAPromptAssets(),
    logger,
  });
  return { agent, promptBuildCalls: prompt.calls, logLines };
}

async function createValidRunRequest(): Promise<AgentRunRequest> {
  const request = createQARequest();
  const assets = loadQAPromptAssets();
  const loader = await createKnowledgeLoaderForTest();
  const knowledge = await loader.load({ context: 'QA' });
  return createQAAgentRunRequest(
    request,
    projectQAPromptContexts(knowledge, request, assets.manifest),
    assets,
  );
}

describe('canonical QA compiler', () => {
  it('deriva IDs, cobertura, matriz, resumo e ranking das fontes', () => {
    const baseProductOwner = createProductOwnerSpecification();
    const productOwnerSpecification = createProductOwnerSpecification({
      acceptanceCriteria: [
        {
          id: 'AC-002',
          given: 'que a entrada está no limite permitido',
          when: 'o fluxo é executado',
          then: 'o contrato permanece válido',
        },
        ...baseProductOwner.acceptanceCriteria,
      ],
      businessRules: [
        {
          id: 'BR-001',
          description: 'Somente dados sintéticos podem ser usados nos testes.',
          source: 'Política de qualidade.',
          condition: 'Durante a preparação dos dados.',
          impact: 'HIGH',
        },
      ],
    });
    const baseTechnical = createTechnicalSpecification();
    const technicalSpecification = createTechnicalSpecification({
      decisions: [
        {
          ...baseTechnical.decisions[0]!,
          id: 'DEC-002',
          title: 'Preservar resultados determinísticos',
        },
        ...baseTechnical.decisions,
      ],
      definitionOfDone: [
        {
          id: 'DOD-002',
          criterion: 'A cobertura permanece reproduzível para entradas idênticas.',
          acceptanceCriteriaIds: ['AC-002'],
        },
        ...baseTechnical.definitionOfDone,
      ],
    });

    const result = compileCanonicalQASpecification({
      productOwnerSpecification,
      technicalSpecification,
    });
    const scenarios = [
      ...result.positiveScenarios,
      ...result.negativeScenarios,
      ...result.edgeCases,
    ];

    expect(result.traceability.functionalCoverage.map(({ sourceId }) => sourceId)).toEqual([
      'AC-001',
      'AC-002',
      'BR-001',
    ]);
    expect(result.traceability.technicalCoverage.map(({ sourceId }) => sourceId)).toEqual([
      'DEC-001',
      'DEC-002',
      'DOD-001',
      'DOD-002',
    ]);
    expect(result.traceability.summary).toEqual({
      acceptanceCriteria: { total: 2, covered: 2 },
      businessRules: { total: 1, covered: 1 },
      technicalDecisions: { total: 2, covered: 2 },
      definitionOfDone: { total: 2, covered: 2 },
    });
    expect(result.traceability.matrix).toEqual([
      {
        id: 'QTR-001',
        functionalSourceIds: ['AC-001', 'AC-002', 'BR-001'],
        technicalSourceIds: ['DEC-001', 'DEC-002', 'DOD-001', 'DOD-002'],
        scenarioIds: ['QAP-001', 'QAN-001', 'QAE-001'],
      },
    ]);
    expect(scenarios).toHaveLength(3);
    expect(scenarios.every((scenario) => scenario.functionalReferences.length === 3)).toBe(true);
    expect(scenarios.every((scenario) => scenario.technicalReferences.length === 4)).toBe(true);
    expect(result.priorityTests.map(({ rank }) => rank)).toEqual([1, 2, 3]);
    expect(
      validateQABusinessRules(result, productOwnerSpecification, technicalSpecification),
    ).toMatchObject({ valid: true, expectedReadiness: 'READY' });
    expect(qaSpecificationSchema.safeParse(result).success).toBe(true);
  });

  it('é independente da ordem das coleções de origem e não inventa incertezas', () => {
    const productOwnerSpecification = createProductOwnerSpecification();
    const technicalSpecification = createTechnicalSpecification();
    const first = compileCanonicalQASpecification({
      productOwnerSpecification,
      technicalSpecification,
    });
    const second = compileCanonicalQASpecification({
      productOwnerSpecification: createProductOwnerSpecification({
        acceptanceCriteria: [...productOwnerSpecification.acceptanceCriteria].reverse(),
        businessRules: [...productOwnerSpecification.businessRules].reverse(),
      }),
      technicalSpecification: createTechnicalSpecification({
        decisions: [...technicalSpecification.decisions].reverse(),
        definitionOfDone: [...technicalSpecification.definitionOfDone].reverse(),
      }),
    });

    expect(second).toEqual(first);
    expect(first.readiness).toBe('READY');
    expect(first.assumptions).toEqual([]);
    expect(first.openQuestions).toEqual([]);
    expect(first.blockingItems).toEqual([]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.traceability)).toBe(true);
  });

  it.each([
    ['PARTIALLY_READY', 'NON_BLOCKING', 'PARTIALLY_READY'],
    ['REQUIRES_CLARIFICATION', 'BLOCKING', 'REQUIRES_CLARIFICATION'],
  ] as const)(
    'propaga readiness %s das fontes sem criar questões locais',
    (sourceReadiness, impact, expectedReadiness) => {
      const productOwnerSpecification = createProductOwnerSpecification({
        readiness: sourceReadiness,
        openQuestions: [
          { id: 'Q-001', question: 'Qual detalhe ainda precisa ser confirmado?', impact },
        ],
      });
      const result = compileCanonicalQASpecification({
        productOwnerSpecification,
        technicalSpecification: createTechnicalSpecification(),
      });

      expect(result.readiness).toBe(expectedReadiness);
      expect(result.openQuestions).toEqual([]);
      expect(result.assumptions).toEqual([]);
    },
  );

  it('rejeita uma fonte estruturalmente inválida em vez de corrigir silenciosamente', () => {
    expect(() =>
      compileCanonicalQASpecification({
        productOwnerSpecification: {
          ...createProductOwnerSpecification(),
          acceptanceCriteria: [{ id: 'fora-do-contrato' }],
        } as never,
        technicalSpecification: createTechnicalSpecification(),
      }),
    ).toThrow();
  });
});

describe('deterministic QA AgentRunner', () => {
  it('usa PromptBuilder, não consome tokens e entrega resposta schema-valid', async () => {
    const { agent, promptBuildCalls, logLines } = await createDeterministicHarness();
    const request = createQARequest();
    const result = await agent.execute(request);

    expect(result.outcome).toBe('GENERATED');
    expect(result.readiness).toBe('READY');
    expect(result.specification?.traceability.summary).toEqual({
      acceptanceCriteria: { total: 1, covered: 1 },
      businessRules: { total: 0, covered: 0 },
      technicalDecisions: { total: 1, covered: 1 },
      definitionOfDone: { total: 1, covered: 1 },
    });
    expect(result.artifacts.map(({ draft }) => draft.filename)).toEqual([
      'test-plan.md',
      'traceability-matrix.json',
      'qa-specification.md',
    ]);
    expect(result.metadata.run.provider).toEqual({
      provider: 'deterministic-qa-compiler',
      requestedModel: request.model,
      responseModel: 'deterministic-qa-compiler-v1',
      responseId: null,
    });
    expect(result.metadata.run.metrics.reported).toEqual({
      durationMs: 0,
      attempts: 1,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect(result.metadata.run.metrics.observed.providerDurationMs).toBe(0);
    expect(result.metadata.run.metrics.observed.bytesSent).toBe(0);
    expect(promptBuildCalls()).toBe(1);
    expect(qaAgentResultSchema.safeParse(result).success).toBe(true);
    expect(logLines.some((line) => line.includes('"executionMode":"DETERMINISTIC"'))).toBe(true);
  });

  it('preserva hashes e artifacts para entradas idênticas', async () => {
    const { agent } = await createDeterministicHarness();
    const first = await agent.execute(createQARequest());
    const second = await agent.execute(createQARequest());

    expect(second.specification).toEqual(first.specification);
    expect(second.metadata.run.prompt.metadata.promptHash).toBe(
      first.metadata.run.prompt.metadata.promptHash,
    );
    expect(second.metadata.run.responseHash).toBe(first.metadata.run.responseHash);
    expect(second.artifacts).toEqual(first.artifacts);
    expect(second.metadata.generation?.generationHash).toBe(
      first.metadata.generation?.generationHash,
    );
  });

  it('rejeita hash de source incompatível antes de construir o prompt', async () => {
    const request = await createValidRunRequest();
    const prompt = countingPromptBuilder();
    const runner = createDeterministicQAAgentRunner({ promptBuilder: prompt.promptBuilder });
    const changedContexts = request.prompt.contexts.map((context) =>
      context.kind === 'ARTIFACT'
        ? { ...context, contentHash: `sha256:${'0'.repeat(64)}` }
        : context,
    );

    await expect(
      runner.run({ ...request, prompt: { ...request.prompt, contexts: changedContexts } }),
    ).rejects.toMatchObject({
      code: AGENT_RUN_ERROR_CODES.INVALID_REQUEST,
      stage: 'REQUEST_VALIDATION',
    });
    expect(prompt.calls()).toBe(0);
  });

  it('rejeita request pertencente a outro agente', async () => {
    const request = await createValidRunRequest();
    const prompt = countingPromptBuilder();
    const runner = createDeterministicQAAgentRunner({ promptBuilder: prompt.promptBuilder });
    const foreignRequest = {
      ...request,
      context: {
        ...request.context,
        execution: { ...request.context.execution, agent: 'DEVELOPER' as const },
      },
      prompt: {
        ...request.prompt,
        template: { ...request.prompt.template, agent: 'DEVELOPER' as const },
      },
    };

    await expect(runner.run(foreignRequest)).rejects.toMatchObject({
      code: AGENT_RUN_ERROR_CODES.INVALID_REQUEST,
      stage: 'REQUEST_VALIDATION',
    });
    expect(prompt.calls()).toBe(0);
  });

  it('honra cancelamento antes de construir o prompt', async () => {
    const request = await createValidRunRequest();
    const prompt = countingPromptBuilder();
    const runner = createDeterministicQAAgentRunner({ promptBuilder: prompt.promptBuilder });
    const controller = new AbortController();
    controller.abort();

    await expect(runner.run(request, { signal: controller.signal })).rejects.toMatchObject({
      code: AGENT_RUN_ERROR_CODES.CANCELLED,
      stage: 'REQUEST_VALIDATION',
    });
    expect(prompt.calls()).toBe(0);
  });

  it('mantém a validação runtime das opções do AgentRunner', async () => {
    const request = await createValidRunRequest();
    const prompt = countingPromptBuilder();
    const runner = createDeterministicQAAgentRunner({ promptBuilder: prompt.promptBuilder });

    await expect(runner.run(request, { signal: 'inválido' } as never)).rejects.toMatchObject({
      code: AGENT_RUN_ERROR_CODES.INVALID_REQUEST,
      stage: 'REQUEST_VALIDATION',
    });
    expect(prompt.calls()).toBe(0);
  });

  it.each(['READ_WRITE', 'REQUIRE_HIT'] as const)(
    'aceita cacheMode %s sem depender de cache ou provider',
    async (cacheMode) => {
      const request = await createValidRunRequest();
      const runner = createDeterministicQAAgentRunner({ promptBuilder: createPromptBuilder() });

      const result = await runner.run(request, { cacheMode });

      expect(result.metrics.reported.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
      expect(result.provider.provider).toBe('deterministic-qa-compiler');
    },
  );

  it('traduz falha do PromptBuilder sem executar fallback generativo', async () => {
    const request = await createValidRunRequest();
    const promptBuilder: PromptBuilder = {
      build() {
        throw new PromptBuilderError('Falha controlada.', {
          code: PROMPT_BUILDER_ERROR_CODES.INVALID_INPUT,
        });
      },
    };
    const runner = createDeterministicQAAgentRunner({ promptBuilder });

    await expect(runner.run(request)).rejects.toEqual(
      expect.objectContaining<Partial<AgentRunError>>({
        code: AGENT_RUN_ERROR_CODES.PROMPT_BUILD_FAILED,
        stage: 'PROMPT_BUILD',
        sourceCode: PROMPT_BUILDER_ERROR_CODES.INVALID_INPUT,
      }),
    );
  });

  it('rejeita resultado tecnicamente inválido do PromptBuilder', async () => {
    const request = await createValidRunRequest();
    const runner = createDeterministicQAAgentRunner({
      promptBuilder: { build: () => ({}) as never },
    });

    await expect(runner.run(request)).rejects.toMatchObject({
      code: AGENT_RUN_ERROR_CODES.INVALID_PROMPT_RESULT,
      stage: 'PROMPT_VALIDATION',
    });
  });
});
