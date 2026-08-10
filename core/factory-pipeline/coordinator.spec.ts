import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentRunner } from '@brq/agent-runner';
import { createArtifactGenerator } from '@brq/artifact-generator';
import {
  CODE_GENERATOR_CONTRACT_LIMITS,
  createCodeGeneratorAgent,
  loadCodeGeneratorPromptAssets,
  type CodeGeneratorAgentResult,
} from '@brq/code-generator-agent';
import { createFilesystemControlledWorkspace } from '@brq/controlled-workspace/filesystem';
import {
  createExecutionEngine,
  type ExecutionRequest,
  type ExecutionResult,
} from '@brq/execution-engine';
import { createKnowledgeLoader } from '@brq/knowledge-loader';
import { createOrchestrator } from '@brq/orchestrator';
import { createProductOwnerAgent, loadProductOwnerPromptAssets } from '@brq/product-owner-agent';
import { createPromptBuilder } from '@brq/prompt-builder';
import { createResponseValidator } from '@brq/response-validator';
import { createQAAgent, loadQAPromptAssets } from '@brq/qa-agent';
import { createDeveloperAgent, loadDeveloperPromptAssets } from '@brq/developer-agent';
import {
  DEFAULT_SANDBOX_LIMITS,
  SANDBOX_RUNNER_ERROR_CODES,
  SANDBOX_RUNNER_ERROR_STAGES,
  finalizeSandboxRunResult,
  type SandboxFailure,
  type SandboxRunRequest,
  type SandboxRunResult,
  type SandboxStepResult,
} from '@brq/sandbox-runner';
import {
  createSandboxExecutionPolicyFixture,
  createSandboxOutputSummaryFixture,
  createSandboxRuntimeObservationFixture,
  createSandboxStepResultsFixture,
} from '@brq/sandbox-runner/testing';
import { createLogger } from '@brq/shared/logger/logger';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createCodeGeneratorAIResponse,
  createCodeGeneratorTechnicalSpecification,
  createGeneratedCodeProposal,
} from '../../agents/code-generator/testing/code-generator-fixtures';
import { createDeveloperAIResponse } from '../../agents/developer/testing/developer-fixtures';
import {
  createProductOwnerAIResponse,
  createProductOwnerSpecification,
} from '../../agents/product-owner/testing/product-owner-fixtures';
import { createQAAIResponse, createQASpecification } from '../../agents/qa/testing/qa-fixtures';
import { FakeAIProvider } from '../ai-provider/fake/fake-ai-provider';
import {
  createExecutionRequestFixture,
  incrementalClock,
} from '../execution-engine/testing/execution-engine-fixtures';
import { FakeKnowledgeSource } from '../knowledge-loader/testing/fake-knowledge-source';
import { createFactoryPipelineCoordinator } from './coordinator';
import { FACTORY_PIPELINE_ERROR_CODES, FactoryPipelineError } from './errors';
import { projectExecutionToCodeGenerationRequest } from './projections';
import {
  createFactoryPipelineConfigurationFixture,
  incrementalFactoryPipelineClock,
} from './testing/factory-pipeline-fixtures';

const EMPTY_SELECTION = { required: [], optional: [] } as const;
const KNOWLEDGE_MANIFEST = {
  version: '1.0.0',
  documents: [
    { id: 'knowledge:factory-po', locator: 'po.md', category: 'AGENT', order: 1 },
    { id: 'knowledge:factory-dev', locator: 'dev.md', category: 'AGENT', order: 2 },
    { id: 'knowledge:factory-qa', locator: 'qa.md', category: 'AGENT', order: 3 },
    {
      id: 'knowledge:factory-pipeline-test',
      locator: 'factory-pipeline.md',
      category: 'ENGINEERING',
      order: 4,
    },
  ],
} as const;
const KNOWLEDGE_POLICY = {
  version: '1.0.0',
  contexts: {
    GLOBAL: EMPTY_SELECTION,
    PRODUCT_OWNER: { required: ['knowledge:factory-po'], optional: [] },
    DEVELOPER: { required: ['knowledge:factory-dev'], optional: [] },
    QA: { required: ['knowledge:factory-qa'], optional: [] },
    CODE_GENERATOR: {
      required: ['knowledge:factory-pipeline-test'],
      optional: [],
    },
    SECURITY: EMPTY_SELECTION,
    ARCHITECTURE: EMPTY_SELECTION,
  },
} as const;

const logger = createLogger({ sink: () => undefined });
const configuration = createFactoryPipelineConfigurationFixture();
const temporaryRoots: string[] = [];
let request: ExecutionRequest;
let execution: ExecutionResult;
let generated: Extract<CodeGeneratorAgentResult, { outcome: 'GENERATED' }>;
let rejected: Extract<CodeGeneratorAgentResult, { outcome: 'VALIDATION_REJECTED' }>;

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

function createSandboxResult(
  sandboxRequest: SandboxRunRequest,
  input: {
    readonly status?: SandboxRunResult['status'];
    readonly steps?: readonly SandboxStepResult[];
    readonly failure?: SandboxFailure | null;
  } = {},
): SandboxRunResult {
  const steps = input.steps ?? createSandboxStepResultsFixture();
  const status = input.status ?? 'SUCCESS';
  const failure = input.failure ?? null;
  return finalizeSandboxRunResult({
    request: sandboxRequest,
    policy: createSandboxExecutionPolicyFixture(),
    effectiveLimits: DEFAULT_SANDBOX_LIMITS,
    runtime: createSandboxRuntimeObservationFixture(),
    status,
    startedAt: '2026-08-10T00:00:00.000Z',
    finishedAt: '2026-08-10T00:00:01.000Z',
    durationMs: 1_000,
    steps,
    resourceOutcome: 'NONE',
    failure,
  });
}

async function codeGeneratorResultFor(
  executionResult: ExecutionResult,
  executionRequest: ExecutionRequest,
  proposal = createGeneratedCodeProposal({
    files: [
      {
        path: 'core/order-query/index.ts',
        content: 'export const ready = true;\n',
        encoding: 'UTF-8',
        mediaType: 'text/typescript',
        purpose: 'SOURCE',
        sourceModuleIds: ['MOD-001'],
        sourcePlanItemIds: ['PLAN-001'],
      },
    ],
    entrypoints: ['core/order-query/index.ts'],
  }),
): Promise<CodeGeneratorAgentResult> {
  const knowledgeLoader = await createKnowledgeLoader({
    source: new FakeKnowledgeSource({
      documents: {
        'po.md': '# Product Owner\n\nProduce a bounded functional specification.',
        'dev.md': '# Developer\n\nProduce a create-only technical specification.',
        'qa.md': '# QA\n\nValidate the approved technical specification.',
        'factory-pipeline.md': '# Factory Pipeline\n\nGenerate safe textual TypeScript files.',
      },
    }),
    manifest: KNOWLEDGE_MANIFEST,
    policy: KNOWLEDGE_POLICY,
    logger,
  });
  const provider = new FakeAIProvider([
    {
      type: 'success',
      response: createCodeGeneratorAIResponse(proposal),
    },
  ]);
  const agent = createCodeGeneratorAgent({
    knowledgeLoader,
    agentRunner: createAgentRunner({
      promptBuilder: createPromptBuilder({
        configuration: { maxBytes: CODE_GENERATOR_CONTRACT_LIMITS.request.promptBytes },
        logger,
      }),
      aiProvider: provider,
      logger,
    }),
    responseValidator: createResponseValidator({ logger }),
    promptAssets: loadCodeGeneratorPromptAssets(),
    logger,
  });
  return agent.execute(
    projectExecutionToCodeGenerationRequest(
      executionResult,
      executionRequest,
      configuration.codeGenerator,
    ),
  );
}

async function createHarness(
  overrides: {
    readonly executionEngine?: { execute: (request: ExecutionRequest) => Promise<ExecutionResult> };
    readonly codeGeneratorAgent?: {
      execute: () => Promise<CodeGeneratorAgentResult>;
    };
    readonly workspace?: ReturnType<typeof createFilesystemControlledWorkspace>;
    readonly sandboxRunner?: { run: (request: SandboxRunRequest) => Promise<SandboxRunResult> };
  } = {},
) {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'brq-factory-pipeline-'));
  temporaryRoots.push(rootPath);
  const workspace =
    overrides.workspace ?? createFilesystemControlledWorkspace({ rootPath, logger });
  const sandboxRunner =
    overrides.sandboxRunner ??
    ({
      run: async (sandboxRequest: SandboxRunRequest) => createSandboxResult(sandboxRequest),
    } as const);
  const coordinator = createFactoryPipelineCoordinator({
    executionEngine: overrides.executionEngine ?? { execute: async () => execution },
    codeGeneratorAgent: overrides.codeGeneratorAgent ?? { execute: async () => generated },
    workspace,
    sandboxRunner,
    configuration,
    logger,
    now: incrementalFactoryPipelineClock(),
  });
  return { coordinator, rootPath, sandboxRunner, workspace };
}

beforeAll(async () => {
  request = createExecutionRequestFixture();
  const source = new FakeKnowledgeSource({
    documents: {
      'po.md': '# Product Owner\n\nProduce a bounded functional specification.',
      'dev.md': '# Developer\n\nProduce a create-only technical specification.',
      'qa.md': '# QA\n\nValidate the approved technical specification.',
      'factory-pipeline.md': '# Factory Pipeline\n\nGenerate safe textual TypeScript files.',
    },
  });
  const knowledgeLoader = await createKnowledgeLoader({
    source,
    manifest: KNOWLEDGE_MANIFEST,
    policy: KNOWLEDGE_POLICY,
    logger,
  });
  const responseValidator = createResponseValidator({ logger });
  const artifactGenerator = createArtifactGenerator({ logger });
  const promptBuilder = createPromptBuilder({ logger });
  const productOwnerAgent = createProductOwnerAgent({
    knowledgeLoader,
    agentRunner: createAgentRunner({
      promptBuilder,
      aiProvider: new FakeAIProvider([
        {
          type: 'success',
          response: createProductOwnerAIResponse(createProductOwnerSpecification()),
        },
      ]),
      logger,
    }),
    responseValidator,
    artifactGenerator,
    promptAssets: loadProductOwnerPromptAssets(),
    logger,
  });
  const technicalSpecification = createCodeGeneratorTechnicalSpecification();
  const developerAgent = createDeveloperAgent({
    knowledgeLoader,
    agentRunner: createAgentRunner({
      promptBuilder,
      aiProvider: new FakeAIProvider([
        { type: 'success', response: createDeveloperAIResponse(technicalSpecification) },
      ]),
      logger,
    }),
    responseValidator,
    artifactGenerator,
    promptAssets: loadDeveloperPromptAssets(),
    logger,
  });
  const qaAgent = createQAAgent({
    knowledgeLoader,
    agentRunner: createAgentRunner({
      promptBuilder,
      aiProvider: new FakeAIProvider([
        { type: 'success', response: createQAAIResponse(createQASpecification()) },
      ]),
      logger,
    }),
    responseValidator,
    artifactGenerator,
    promptAssets: loadQAPromptAssets(),
    logger,
  });
  const identityEngine = createExecutionEngine({
    orchestrator: createOrchestrator({
      productOwnerAgent,
      developerAgent,
      qaAgent,
      logger,
      now: incrementalClock(1_786_320_000_000),
    }),
    logger,
    now: incrementalClock(1_786_320_000_000),
  });
  execution = await identityEngine.execute(request);
  const generatedResult = await codeGeneratorResultFor(execution, request);
  if (generatedResult.outcome !== 'GENERATED') throw new Error('Expected generated fixture.');
  generated = generatedResult;
  const unsafe = createGeneratedCodeProposal({
    files: [
      {
        ...createGeneratedCodeProposal().files[0]!,
        path: '../escape.ts',
      },
    ],
    entrypoints: ['../escape.ts'],
  });
  const rejectedResult = await codeGeneratorResultFor(execution, request, unsafe);
  if (rejectedResult.outcome !== 'VALIDATION_REJECTED') {
    throw new Error('Expected rejected fixture.');
  }
  rejected = rejectedResult;
});

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((rootPath) => rm(rootPath, { recursive: true, force: true })),
  );
});

describe('FactoryPipelineCoordinator', () => {
  it('rejects invalid host configuration and invalid requests before invoking ports', async () => {
    expect(() =>
      createFactoryPipelineCoordinator({
        executionEngine: { execute: async () => execution },
        codeGeneratorAgent: { execute: async () => generated },
        workspace: {
          plan: () => {
            throw new Error('not called');
          },
          materialize: async () => {
            throw new Error('not called');
          },
          release: async () => {
            throw new Error('not called');
          },
        },
        sandboxRunner: {
          run: async () => {
            throw new Error('not called');
          },
        },
        configuration: {
          codeGenerator: { agentVersion: '1.0.0', model: '' },
          sandbox: { policyId: 'NODE_NONE_24_V1' },
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<FactoryPipelineError>>({
        code: FACTORY_PIPELINE_ERROR_CODES.INVALID_CONFIGURATION,
      }),
    );

    const { coordinator } = await createHarness();
    const invalidRequest = { ...request, workflowId: '' } as ExecutionRequest;
    await expect(coordinator.execute(invalidRequest)).rejects.toMatchObject({
      code: FACTORY_PIPELINE_ERROR_CODES.INVALID_REQUEST,
    });
  });

  it('runs the full pipeline with public ports, preserves hashes and releases the workspace', async () => {
    const { coordinator, rootPath } = await createHarness();
    const result = await coordinator.execute(request);

    expect(result.status).toBe('SUCCESS');
    expect(result.stages).toHaveLength(11);
    expect(result.stages.every((stage) => stage.status === 'SUCCESS')).toBe(true);
    expect(result.generation.hashes?.bundleHash).toBe(generated.bundle.hashes.bundleHash);
    expect(result.lineage.generatedBundleHash).toBe(generated.bundle.hashes.bundleHash);
    expect(result.workspace.releaseStatus).toBe('RELEASED');
    expect(result.sandbox.steps.map((step) => step.status)).toEqual([
      'SUCCESS',
      'SUCCESS',
      'SUCCESS',
      'SUCCESS',
    ]);
    expect(result.hashes.sandboxResultHash).toBe(result.sandbox.hashes?.sandboxResultHash);
    expect(Object.isFrozen(result)).toBe(true);
    await expect(access(path.join(rootPath, result.workspace.workspaceId!))).rejects.toBeDefined();
    expect(JSON.stringify(result)).not.toContain('export const ready');
  });

  it('preserves a functional TEST failure and releases the workspace without throwing', async () => {
    const output = createSandboxOutputSummaryFixture();
    const failure: SandboxFailure = {
      code: SANDBOX_RUNNER_ERROR_CODES.STEP_FAILED,
      stage: SANDBOX_RUNNER_ERROR_STAGES.TEST,
      message: 'A etapa falhou.',
      sourceCode: 'private diagnostic must not cross boundary',
    };
    const successful = createSandboxStepResultsFixture();
    const steps: readonly SandboxStepResult[] = [
      ...successful.slice(0, 3),
      {
        ...successful[3]!,
        status: 'FAILED',
        exitCode: 1,
        stdout: output,
        stderr: output,
        failure,
      },
    ];
    const { coordinator } = await createHarness({
      sandboxRunner: {
        run: async (sandboxRequest) =>
          createSandboxResult(sandboxRequest, { status: 'FAILED', steps, failure }),
      },
    });

    const result = await coordinator.execute(request);
    expect(result.status).toBe('FAILED');
    expect(result.terminalStage).toBe('SANDBOX_TEST');
    expect(result.stages.find((stage) => stage.stageId === 'SANDBOX_BUILD')?.status).toBe(
      'SUCCESS',
    );
    expect(result.stages.find((stage) => stage.stageId === 'SANDBOX_TEST')?.status).toBe('FAILED');
    expect(result.failure?.sourceCode).toBeNull();
    expect(result.sandbox.steps[3]?.failure?.sourceCode).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private diagnostic');
    expect(result.workspace.releaseStatus).toBe('RELEASED');
  });

  it('uses the aggregate SANDBOX boundary for cleanup failure without falsifying TEST', async () => {
    const failure: SandboxFailure = {
      code: SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED,
      stage: SANDBOX_RUNNER_ERROR_STAGES.CLEANUP,
      message: 'Cleanup failed.',
      sourceCode: 'REMOVE_FAILED',
    };
    const { coordinator } = await createHarness({
      sandboxRunner: {
        run: async (sandboxRequest) =>
          createSandboxResult(sandboxRequest, { status: 'FAILED', failure }),
      },
    });
    const result = await coordinator.execute(request);
    expect(result.status).toBe('FAILED');
    expect(result.terminalStage).toBe('SANDBOX');
    expect(result.stages.find((stage) => stage.stageId === 'SANDBOX_TEST')?.status).toBe('SUCCESS');
  });

  it('fails fast on Code Generator error and never plans, materializes or runs downstream', async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'brq-factory-pipeline-'));
    temporaryRoots.push(rootPath);
    const realWorkspace = createFilesystemControlledWorkspace({ rootPath, logger });
    const plan = vi.fn(realWorkspace.plan);
    const materialize = vi.fn(realWorkspace.materialize);
    const workspace = {
      plan,
      materialize,
      release: realWorkspace.release,
    };
    const sandboxRun = vi.fn();
    const { coordinator } = await createHarness({
      codeGeneratorAgent: {
        execute: async () => {
          throw Object.assign(new Error('provider payload must stay private'), {
            code: 'private token=must-not-cross-boundary',
          });
        },
      },
      workspace,
      sandboxRunner: { run: sandboxRun },
    });

    const result = await coordinator.execute(request);
    expect(result.status).toBe('FAILED');
    expect(result.terminalStage).toBe('CODE_GENERATOR');
    expect(result.stages.find((stage) => stage.stageId === 'WORKSPACE_PLAN')?.status).toBe(
      'SKIPPED',
    );
    expect(plan).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(sandboxRun).not.toHaveBeenCalled();
    expect(result.failure?.sourceCode).toBeNull();
    expect(JSON.stringify(result)).not.toContain('provider payload must stay private');
    expect(JSON.stringify(result)).not.toContain('must-not-cross-boundary');
  });

  it('treats Code Generator business rejection as a functional failure with downstream skipped', async () => {
    const sandboxRun = vi.fn();
    const { coordinator } = await createHarness({
      codeGeneratorAgent: { execute: async () => rejected },
      sandboxRunner: { run: sandboxRun },
    });
    const result = await coordinator.execute(request);
    expect(result.status).toBe('FAILED');
    expect(result.generation.outcome).toBe('VALIDATION_REJECTED');
    expect(result.failure?.code).toBe(FACTORY_PIPELINE_ERROR_CODES.CODE_GENERATION_REJECTED);
    expect(result.workspace.planStatus).toBe('SKIPPED');
    expect(sandboxRun).not.toHaveBeenCalled();
  });

  it('stops at workspace planning and materialization technical failures', async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'brq-factory-pipeline-'));
    temporaryRoots.push(rootPath);
    const realWorkspace = createFilesystemControlledWorkspace({ rootPath, logger });
    const sandboxRun = vi.fn();
    const planning = await createHarness({
      workspace: {
        plan: () => {
          throw Object.assign(new Error('unsafe plan'), { code: 'WORKSPACE_INVALID_REQUEST' });
        },
        materialize: realWorkspace.materialize,
        release: realWorkspace.release,
      },
      sandboxRunner: { run: sandboxRun },
    });
    const planResult = await planning.coordinator.execute(request);
    expect(planResult.terminalStage).toBe('WORKSPACE_PLAN');
    expect(planResult.workspace.materializationStatus).toBe('SKIPPED');

    const materialization = await createHarness({
      workspace: {
        plan: realWorkspace.plan,
        materialize: async () => {
          throw Object.assign(new Error('private root'), { code: 'WORKSPACE_WRITE_FAILED' });
        },
        release: realWorkspace.release,
      },
      sandboxRunner: { run: sandboxRun },
    });
    const materializationResult = await materialization.coordinator.execute(request);
    expect(materializationResult.terminalStage).toBe('WORKSPACE_MATERIALIZATION');
    expect(materializationResult.workspace.materializationStatus).toBe('FAILED');
    expect(sandboxRun).not.toHaveBeenCalled();
  });

  it('requests compensating release when a materialized workspace violates correlation', async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'brq-factory-pipeline-'));
    temporaryRoots.push(rootPath);
    const realWorkspace = createFilesystemControlledWorkspace({ rootPath, logger });
    let materialized: Awaited<ReturnType<typeof realWorkspace.materialize>> | null = null;
    const release = vi.fn(async () => realWorkspace.release(materialized!));
    const { coordinator } = await createHarness({
      workspace: {
        plan: realWorkspace.plan,
        materialize: async (plan, options) => {
          materialized = await realWorkspace.materialize(plan, options);
          const tampered = structuredClone(materialized) as Mutable<
            NonNullable<typeof materialized>
          >;
          tampered.source.bundleHash = '0'.repeat(64);
          return tampered;
        },
        release,
      },
    });

    const result = await coordinator.execute(request);
    expect(result.status).toBe('FAILED');
    expect(result.terminalStage).toBe('WORKSPACE_MATERIALIZATION');
    expect(result.failure?.code).toBe(FACTORY_PIPELINE_ERROR_CODES.CONTRACT_VIOLATION);
    expect(release).toHaveBeenCalledOnce();
    await expect(access(path.join(rootPath, materialized!.workspaceId))).rejects.toBeDefined();
  });

  it('maps a Sandbox port error and cancellation without leaking its cause', async () => {
    const failed = await createHarness({
      sandboxRunner: {
        run: async () => {
          throw Object.assign(new Error('docker daemon private diagnostics'), {
            code: 'SANDBOX_RUNTIME_UNAVAILABLE',
          });
        },
      },
    });
    const failedResult = await failed.coordinator.execute(request);
    expect(failedResult.status).toBe('FAILED');
    expect(failedResult.terminalStage).toBe('SANDBOX_PREPARE');
    expect(failedResult.workspace.releaseStatus).toBe('RELEASED');
    expect(JSON.stringify(failedResult)).not.toContain('docker daemon private diagnostics');

    const controller = new AbortController();
    const cancelled = await createHarness({
      sandboxRunner: {
        run: async () => {
          controller.abort();
          throw Object.assign(new Error('cancelled'), { code: 'SANDBOX_CANCELLED' });
        },
      },
    });
    const cancelledResult = await cancelled.coordinator.execute(request, {
      signal: controller.signal,
    });
    expect(cancelledResult.status).toBe('CANCELLED');
    expect(cancelledResult.workspace.releaseStatus).toBe('RELEASED');
  });

  it('propagates cancellation through the Code Generator and returns CANCELLED', async () => {
    const controller = new AbortController();
    const codeGenerator = vi.fn(async () => {
      controller.abort();
      throw Object.assign(new Error('aborted'), { code: 'CODE_GENERATOR_CANCELLED' });
    });
    const { coordinator } = await createHarness({
      codeGeneratorAgent: { execute: codeGenerator },
    });
    const result = await coordinator.execute(request, { signal: controller.signal });
    expect(result.status).toBe('CANCELLED');
    expect(result.terminalStage).toBe('CODE_GENERATOR');
    expect(result.stages.find((stage) => stage.stageId === 'CODE_GENERATOR')?.status).toBe(
      'CANCELLED',
    );
    expect(result.stages.find((stage) => stage.stageId === 'SANDBOX_PREPARE')?.status).toBe(
      'SKIPPED',
    );
  });

  it('honors a pre-aborted signal even when an injected upstream port ignores it', async () => {
    const controller = new AbortController();
    controller.abort();
    const codeGenerator = vi.fn(async () => generated);
    const { coordinator } = await createHarness({
      executionEngine: { execute: async () => execution },
      codeGeneratorAgent: { execute: codeGenerator },
    });

    const result = await coordinator.execute(request, { signal: controller.signal });
    expect(result.status).toBe('CANCELLED');
    expect(result.terminalStage).toBe('CODE_GENERATOR');
    expect(codeGenerator).not.toHaveBeenCalled();
    expect(result.stages.find((stage) => stage.stageId === 'WORKSPACE_PLAN')?.status).toBe(
      'SKIPPED',
    );
  });

  it('rejects a tampered Code Generator correlation before workspace planning', async () => {
    const tampered = structuredClone(generated) as Mutable<typeof generated>;
    tampered.context.agentExecutionId = 'agent-execution-tampered';
    const sandboxRun = vi.fn();
    const { coordinator } = await createHarness({
      codeGeneratorAgent: { execute: async () => tampered },
      sandboxRunner: { run: sandboxRun },
    });
    const result = await coordinator.execute(request);
    expect(result.status).toBe('FAILED');
    expect(result.terminalStage).toBe('CODE_GENERATOR');
    expect(result.failure?.code).toBe(FACTORY_PIPELINE_ERROR_CODES.CONTRACT_VIOLATION);
    expect(result.workspace.planStatus).toBe('SKIPPED');
    expect(sandboxRun).not.toHaveBeenCalled();
  });

  it('rejects Sandbox result tampering, preserves prior hashes and still releases workspace', async () => {
    const { coordinator } = await createHarness({
      sandboxRunner: {
        run: async (sandboxRequest) => {
          const tampered = structuredClone(
            createSandboxResult(sandboxRequest),
          ) as Mutable<SandboxRunResult>;
          tampered.hashes.sandboxResultHash = '0'.repeat(64);
          return tampered;
        },
      },
    });
    const result = await coordinator.execute(request);
    expect(result.status).toBe('FAILED');
    expect(result.terminalStage).toBe('SANDBOX_PREPARE');
    expect(result.failure?.code).toBe(FACTORY_PIPELINE_ERROR_CODES.CONTRACT_VIOLATION);
    expect(result.hashes.bundleHash).toBe(generated.bundle.hashes.bundleHash);
    expect(result.workspace.releaseStatus).toBe('RELEASED');
    expect(result.sandbox.hashes).toBeNull();
  });

  it('turns workspace release failure into a terminal metadata-safe result', async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'brq-factory-pipeline-'));
    temporaryRoots.push(rootPath);
    const realWorkspace = createFilesystemControlledWorkspace({ rootPath, logger });
    const { coordinator } = await createHarness({
      workspace: {
        plan: realWorkspace.plan,
        materialize: realWorkspace.materialize,
        release: async () => {
          throw Object.assign(new Error('private root path'), { code: 'WORKSPACE_RELEASE_FAILED' });
        },
      },
    });
    const result = await coordinator.execute(request);
    expect(result.status).toBe('FAILED');
    expect(result.terminalStage).toBe('WORKSPACE_RELEASE');
    expect(result.workspace.releaseStatus).toBe('FAILED');
    expect(JSON.stringify(result)).not.toContain('private root path');
  });

  it('consolidates a terminal ExecutionEngineError result instead of losing upstream metadata', async () => {
    const workflowResult = execution.workflowResult;
    if (workflowResult === null) throw new Error('Expected workflow fixture.');
    const failedEngine = createExecutionEngine({
      orchestrator: {
        execute: async () => ({
          ...workflowResult,
          status: 'FAILED' as const,
          failure: {
            kind: 'VALIDATION_REJECTED' as const,
            stage: 'QA' as const,
            agent: 'QA' as const,
            code: 'ORCHESTRATOR_QA_FAILED',
            sourceCode: 'QA_REJECTED',
            message: 'QA rejected.',
          },
        }),
      },
      logger,
      now: incrementalClock(1_786_320_100_000),
    });
    const { coordinator } = await createHarness({ executionEngine: failedEngine });
    const result = await coordinator.execute(request);
    expect(result.status).toBe('FAILED');
    expect(result.execution.status).toBe('FAILED');
    expect(result.hashes.executionHash).toBeTruthy();
    expect(result.stages.find((stage) => stage.stageId === 'CODE_GENERATOR')?.status).toBe(
      'SKIPPED',
    );
  });

  it('throws a typed technical error when Execution Engine has no terminal result', async () => {
    const { coordinator } = await createHarness({
      executionEngine: {
        execute: async () => {
          throw Object.assign(new Error('internal details'), { code: 'EXECUTION_ENGINE_INTERNAL' });
        },
      },
    });
    await expect(coordinator.execute(request)).rejects.toMatchObject({
      code: FACTORY_PIPELINE_ERROR_CODES.EXECUTION_FAILED,
      stage: 'EXECUTION',
      result: undefined,
    });
  });
});
