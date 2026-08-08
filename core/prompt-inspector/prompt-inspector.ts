import { KnowledgeLoaderError } from '@brq/knowledge-loader';
import {
  PROMPT_BUILDER_ERROR_CODES,
  PromptBuilderError,
  type PromptResult,
} from '@brq/prompt-builder';

import type {
  CreatePromptInspectorOptions,
  PromptInspectionAgent,
  PromptInspectionBuiltPreview,
  PromptInspectionCatalog,
  PromptInspectionOperationOptions,
  PromptInspectionPipelineNode,
  PromptInspectionPreviewRequest,
  PromptInspectionPreviewResult,
  PromptInspectionRejectedPreview,
  PromptInspectionStage,
  PromptInspectionValidateRequest,
  PromptInspectionValidationResult,
  PromptInspectionVersions,
  PromptInspector,
  PromptInspectorAgentAdapter,
} from './contracts';
import { PROMPT_INSPECTOR_ERROR_CODES, PromptInspectorError } from './errors';
import { deepFreeze } from './immutability';
import {
  PROMPT_INSPECTOR_CONTRACT_VERSION,
  PROMPT_INSPECTOR_MAX_ADAPTERS,
  PROMPT_INSPECTOR_RETENTION,
  PROMPT_INSPECTOR_VERSION,
} from './limits';
import { logPromptInspection } from './logging';
import { projectOutputContract } from './output-contract-projection';
import {
  completedInspectionPipeline,
  idleInspectionPipeline,
  projectKnowledgeContext,
  projectPromptSections,
  PROMPT_INSPECTION_STAGES,
} from './prompt-projection';
import {
  promptInspectionBuiltPreviewSchema,
  promptInspectionCatalogAgentSchema,
  promptInspectionCatalogSchema,
  promptInspectionPreviewRequestSchema,
  promptInspectionRejectedPreviewSchema,
  promptInspectionValidateRequestSchema,
  promptInspectionValidationResultSchema,
  promptInspectionVersionsSchema,
} from './schemas';
import { validateCandidate } from './validation-preview';

interface CompletedBuild {
  readonly adapter: PromptInspectorAgentAdapter;
  readonly parsedInput: unknown;
  readonly promptResult: PromptResult;
  readonly preview: PromptInspectionBuiltPreview;
}

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

function assertNotAborted(signal: AbortSignal | undefined, stage: PromptInspectionStage): void {
  if (signal?.aborted === true) {
    throw new PromptInspectorError('A inspeção do prompt foi cancelada.', {
      code: PROMPT_INSPECTOR_ERROR_CODES.CANCELLED,
      stage,
    });
  }
}

function versionsFor(adapter: PromptInspectorAgentAdapter): PromptInspectionVersions {
  return promptInspectionVersionsSchema.parse({
    inspectorVersion: PROMPT_INSPECTOR_VERSION,
    contractVersion: PROMPT_INSPECTOR_CONTRACT_VERSION,
    ...adapter.versions,
  });
}

function assertConfiguration(options: CreatePromptInspectorOptions): void {
  if (
    options.knowledgeLoader === undefined ||
    options.promptBuilder === undefined ||
    options.responseValidator === undefined ||
    !Array.isArray(options.adapters) ||
    options.adapters.length === 0 ||
    options.adapters.length > PROMPT_INSPECTOR_MAX_ADAPTERS ||
    (options.now !== undefined && typeof options.now !== 'function')
  ) {
    throw new PromptInspectorError('Configuração do Prompt Inspector inválida.', {
      code: PROMPT_INSPECTOR_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }

  const seenAgents = new Set<PromptInspectionAgent>();
  for (const adapter of options.adapters) {
    if (
      seenAgents.has(adapter.agent) ||
      typeof adapter.buildPromptInput !== 'function' ||
      typeof adapter.validateBusiness !== 'function' ||
      typeof adapter.inputSchema?.safeParse !== 'function' ||
      typeof adapter.agentContractSchema?.safeParse !== 'function'
    ) {
      throw new PromptInspectorError('Configuração de adapter do Prompt Inspector inválida.', {
        code: PROMPT_INSPECTOR_ERROR_CODES.INVALID_CONFIGURATION,
      });
    }

    const catalogAdapter = promptInspectionCatalogAgentSchema.safeParse({
      agent: adapter.agent,
      label: adapter.label,
      description: adapter.description,
      inputKind: adapter.inputKind,
      versions: {
        inspectorVersion: PROMPT_INSPECTOR_VERSION,
        contractVersion: PROMPT_INSPECTOR_CONTRACT_VERSION,
        ...adapter.versions,
      },
      activeBundleHash: adapter.activeBundleHash,
      examples: adapter.examples,
    });
    if (!catalogAdapter.success) {
      throw new PromptInspectorError('Metadados de adapter do Prompt Inspector inválidos.', {
        code: PROMPT_INSPECTOR_ERROR_CODES.INVALID_CONFIGURATION,
        cause: catalogAdapter.error,
      });
    }
    seenAgents.add(adapter.agent);
  }
}

function rejectedPipeline(stage: PromptInspectionStage): readonly PromptInspectionPipelineNode[] {
  const failedIndex = PROMPT_INSPECTION_STAGES.indexOf(stage);
  return PROMPT_INSPECTION_STAGES.map((candidate, index) => ({
    stage: candidate,
    status: index < failedIndex ? 'VALID' : index === failedIndex ? 'ERROR' : 'IDLE',
    detail: index === failedIndex ? 'Inspection stopped at this boundary.' : null,
  }));
}

function rejectedPreview(
  agent: PromptInspectionAgent,
  stage: PromptInspectionStage,
  code: string,
): PromptInspectionRejectedPreview {
  return deepFreeze(
    promptInspectionRejectedPreviewSchema.parse({
      status: 'REJECTED',
      agent,
      retention: PROMPT_INSPECTOR_RETENTION,
      pipeline: rejectedPipeline(stage),
      error: {
        code,
        stage,
        message: 'The prompt inspection could not be completed at this boundary.',
      },
    }),
  );
}

function catalogFor(adapters: readonly PromptInspectorAgentAdapter[]): PromptInspectionCatalog {
  return deepFreeze(
    promptInspectionCatalogSchema.parse({
      contractVersion: PROMPT_INSPECTOR_CONTRACT_VERSION,
      retention: PROMPT_INSPECTOR_RETENTION,
      pipeline: idleInspectionPipeline(),
      agents: adapters.map((adapter) => ({
        agent: adapter.agent,
        label: adapter.label,
        description: adapter.description,
        inputKind: adapter.inputKind,
        versions: versionsFor(adapter),
        activeBundleHash: adapter.activeBundleHash,
        examples: adapter.examples,
      })),
    }),
  );
}

export function createPromptInspector(options: CreatePromptInspectorOptions): PromptInspector {
  assertConfiguration(options);
  const now = options.now ?? (() => performance.now());
  const adapters = new Map(options.adapters.map((adapter) => [adapter.agent, adapter]));
  const catalog = catalogFor(options.adapters);

  function adapterFor(agent: PromptInspectionAgent): PromptInspectorAgentAdapter {
    const adapter = adapters.get(agent);
    if (adapter === undefined) {
      throw new PromptInspectorError('Agente não disponível no Prompt Inspector.', {
        code: PROMPT_INSPECTOR_ERROR_CODES.UNKNOWN_AGENT,
      });
    }
    return adapter;
  }

  function parseInput(adapter: PromptInspectorAgentAdapter, input: unknown): unknown {
    const parsed = adapter.inputSchema.safeParse(input);
    if (!parsed.success) {
      throw new PromptInspectorError('Entrada do Prompt Inspector inválida.', {
        code: PROMPT_INSPECTOR_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  async function build(
    rawRequest: PromptInspectionPreviewRequest,
    operationOptions: PromptInspectionOperationOptions = {},
  ): Promise<CompletedBuild | PromptInspectionRejectedPreview> {
    assertNotAborted(operationOptions.signal, 'KNOWLEDGE');
    const requestResult = promptInspectionPreviewRequestSchema.safeParse(rawRequest);
    if (!requestResult.success) {
      throw new PromptInspectorError('Solicitação do Prompt Inspector inválida.', {
        code: PROMPT_INSPECTOR_ERROR_CODES.INVALID_INPUT,
        cause: requestResult.error,
      });
    }

    const request = requestResult.data;
    const adapter = adapterFor(request.agent);
    const parsedInput = parseInput(adapter, request.input);
    let knowledgeContext;

    try {
      knowledgeContext = await options.knowledgeLoader.load({ context: adapter.knowledgeContext });
    } catch (error) {
      return rejectedPreview(
        request.agent,
        'KNOWLEDGE',
        error instanceof KnowledgeLoaderError
          ? error.code
          : PROMPT_INSPECTOR_ERROR_CODES.INSPECTION_FAILED,
      );
    }
    assertNotAborted(operationOptions.signal, 'KNOWLEDGE');

    let promptInput;
    try {
      assertNotAborted(operationOptions.signal, 'RESOLUTION');
      promptInput = adapter.buildPromptInput(parsedInput, knowledgeContext);
    } catch (error) {
      if (error instanceof PromptInspectorError) throw error;
      return rejectedPreview(
        request.agent,
        'RESOLUTION',
        PROMPT_INSPECTOR_ERROR_CODES.INSPECTION_FAILED,
      );
    }

    let promptResult;
    try {
      assertNotAborted(operationOptions.signal, 'RENDERING');
      promptResult = options.promptBuilder.build(promptInput);
    } catch (error) {
      if (error instanceof PromptInspectorError) throw error;
      const stage =
        error instanceof PromptBuilderError &&
        error.code === PROMPT_BUILDER_ERROR_CODES.BUDGET_EXCEEDED
          ? 'BUDGET'
          : 'RESOLUTION';
      return rejectedPreview(
        request.agent,
        stage,
        error instanceof PromptBuilderError
          ? error.code
          : PROMPT_INSPECTOR_ERROR_CODES.INSPECTION_FAILED,
      );
    }

    const sections = projectPromptSections(promptResult);
    assertNotAborted(operationOptions.signal, 'CONTRACT');
    const budgetRatio = promptResult.budget.usedBytes / promptResult.budget.maxBytes;
    const outputContract = projectOutputContract(
      promptResult.outputContract,
      promptResult.metadata.outputContractHash,
    );
    const preview = deepFreeze(
      promptInspectionBuiltPreviewSchema.parse({
        status: 'BUILT',
        agent: request.agent,
        retention: PROMPT_INSPECTOR_RETENTION,
        versions: versionsFor(adapter),
        pipeline: completedInspectionPipeline(promptResult, knowledgeContext),
        sections,
        trustBoundaries: {
          trustedSectionIds: sections
            .filter((section) => section.trust === 'TRUSTED')
            .map((section) => section.id),
          untrustedSectionIds: sections
            .filter((section) => section.trust === 'UNTRUSTED')
            .map((section) => section.id),
        },
        prompt: promptResult.rendered,
        budget: {
          ...promptResult.budget,
          remainingBytes: Math.max(0, promptResult.budget.maxBytes - promptResult.budget.usedBytes),
          utilizationPercent: Math.min(100, Math.round(budgetRatio * 10_000) / 100),
          status: budgetRatio >= 0.8 ? 'WARNING' : 'VALID',
        },
        knowledge: projectKnowledgeContext(knowledgeContext),
        hashes: {
          bundleHash: adapter.activeBundleHash,
          templateHash: promptResult.metadata.templateHash,
          promptHash: promptResult.metadata.promptHash,
          instructionsHash: promptResult.metadata.instructionsHash,
          inputHash: promptResult.metadata.inputHash,
          outputContractHash: promptResult.metadata.outputContractHash,
          ruleSetHashes: promptResult.metadata.ruleSetHashes,
          contextHashes: promptResult.metadata.contextHashes,
        },
        outputContract,
      }),
    );

    return { adapter, parsedInput, promptResult, preview };
  }

  return Object.freeze({
    catalog(): PromptInspectionCatalog {
      return catalog;
    },

    async preview(
      request: PromptInspectionPreviewRequest,
      operationOptions: PromptInspectionOperationOptions = {},
    ): Promise<PromptInspectionPreviewResult> {
      const startedAt = now();
      const result = await build(request, operationOptions);
      const preview = 'preview' in result ? result.preview : result;
      logPromptInspection(
        options.logger,
        preview.status === 'BUILT' ? 'info' : 'warn',
        preview.status === 'BUILT' ? 'prompt.inspection.completed' : 'prompt.inspection.rejected',
        {
          agent: preview.agent,
          status: preview.status,
          ...(preview.status === 'BUILT' ? { promptHash: preview.hashes.promptHash } : {}),
          ...(preview.status === 'REJECTED' ? { errorCode: preview.error.code } : {}),
          durationMs: elapsed(now, startedAt),
        },
      );
      return preview;
    },

    async validate(
      rawRequest: PromptInspectionValidateRequest,
      operationOptions: PromptInspectionOperationOptions = {},
    ): Promise<PromptInspectionValidationResult> {
      const startedAt = now();
      assertNotAborted(operationOptions.signal, 'KNOWLEDGE');
      const requestResult = promptInspectionValidateRequestSchema.safeParse(rawRequest);
      if (!requestResult.success) {
        throw new PromptInspectorError('Solicitação de validação do Prompt Inspector inválida.', {
          code: PROMPT_INSPECTOR_ERROR_CODES.INVALID_INPUT,
          cause: requestResult.error,
        });
      }

      const request = requestResult.data;
      const built = await build({ agent: request.agent, input: request.input }, operationOptions);
      if (!('preview' in built)) {
        throw new PromptInspectorError('O prompt precisa ser construído antes da validação.', {
          code: PROMPT_INSPECTOR_ERROR_CODES.INSPECTION_FAILED,
          stage: built.error.stage,
        });
      }

      let result;
      try {
        assertNotAborted(operationOptions.signal, 'CONTRACT');
        result = validateCandidate({
          agent: built.adapter.agent,
          versions: built.preview.versions,
          promptResult: built.promptResult,
          projectedContract: built.preview.outputContract,
          validationContract: built.adapter.validationContract,
          agentContractSchema: built.adapter.agentContractSchema,
          businessValidate: (candidate) =>
            built.adapter.validateBusiness(candidate, built.parsedInput),
          candidateContent: request.candidate.content,
          responseValidator: options.responseValidator,
        });
      } catch (error) {
        if (error instanceof PromptInspectorError) throw error;
        throw new PromptInspectorError('A validação inspecionada não pôde ser concluída.', {
          code: PROMPT_INSPECTOR_ERROR_CODES.INSPECTION_FAILED,
          stage: 'CONTRACT',
          cause: error,
        });
      }

      const validatedResult = deepFreeze(promptInspectionValidationResultSchema.parse(result));
      logPromptInspection(
        options.logger,
        validatedResult.status === 'PASS' ? 'info' : 'warn',
        validatedResult.status === 'PASS'
          ? 'prompt.inspection.validation.accepted'
          : 'prompt.inspection.validation.rejected',
        {
          agent: validatedResult.agent,
          status: validatedResult.status,
          candidateHash: validatedResult.candidateHash,
          durationMs: elapsed(now, startedAt),
        },
      );
      return validatedResult;
    },
  });
}
