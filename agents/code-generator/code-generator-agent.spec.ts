import { Buffer } from 'node:buffer';

import { createAgentRunner } from '@brq/agent-runner';
import { createKnowledgeLoader, type KnowledgeLoader } from '@brq/knowledge-loader';
import {
  NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE,
  projectGenerationProfileConstraints,
} from '@brq/factory-execution-profile';
import {
  calculateCanonicalJsonHash,
  calculatePromptHash,
  canonicalizeJson,
  createPromptBuilder,
} from '@brq/prompt-builder';
import {
  createResponseValidator,
  RESPONSE_VALIDATOR_ERROR_CODES,
  ResponseValidatorError,
  type ResponseValidator,
} from '@brq/response-validator';
import { createLogger } from '@brq/shared/logger/logger';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  FakeAIProvider,
  type FakeAIProviderOutcome,
} from '../../core/ai-provider/fake/fake-ai-provider';
import { FakeKnowledgeSource } from '../../core/knowledge-loader/testing/fake-knowledge-source';
import { createCodeGeneratorAgent } from './code-generator-agent';
import { CODE_GENERATOR_AGENT_ERROR_CODES } from './errors';
import {
  calculateBundleContentHash,
  calculateCodeGenerationHash,
  calculateCodeGenerationLineageHash,
  calculateCodeGenerationProvenanceHash,
  calculateGeneratedBundleHash,
  calculateGeneratedContentHash,
  calculateGeneratedFileHash,
  calculateGeneratedManifestHash,
  CODE_BUNDLE_CONTENT_HASH_DOMAIN,
  projectGeneratedManifestFile,
} from './hashing';
import { CODE_GENERATOR_CONTRACT_LIMITS } from './limits';
import { loadCodeGeneratorPromptAssets } from './prompt-assets';
import { codeGeneratorAgentResultSchema, generatedCodeBundleSchema } from './schemas';
import {
  createCodeGenerationRequest,
  createCodeGeneratorAIResponse,
  createCodeGeneratorTechnicalSpecification,
  createGeneratedCodeProposal,
} from './testing/code-generator-fixtures';

const EMPTY_SELECTION = { required: [], optional: [] } as const;
const MANIFEST = {
  version: '1.0.0',
  documents: [
    {
      id: 'knowledge:code-generator-test',
      locator: 'code-generator.md',
      category: 'ENGINEERING',
      order: 1,
    },
  ],
} as const;
const POLICY = {
  version: '1.0.0',
  contexts: {
    GLOBAL: EMPTY_SELECTION,
    PRODUCT_OWNER: EMPTY_SELECTION,
    DEVELOPER: EMPTY_SELECTION,
    QA: EMPTY_SELECTION,
    CODE_GENERATOR: {
      required: ['knowledge:code-generator-test'],
      optional: [],
    },
    SECURITY: EMPTY_SELECTION,
    ARCHITECTURE: EMPTY_SELECTION,
  },
} as const;

interface HarnessOptions {
  readonly outcomes?: FakeAIProviderOutcome[];
  readonly knowledgeContent?: string;
  readonly knowledgeLoader?: KnowledgeLoader;
  readonly responseValidator?: ResponseValidator;
}

type MutableGeneratedCodeBundle = z.infer<typeof generatedCodeBundleSchema>;
type MutableCodeGeneratorResult = z.infer<typeof codeGeneratorAgentResultSchema>;
type MutableGeneratedResult = Extract<MutableCodeGeneratorResult, { outcome: 'GENERATED' }>;
type MutableRejectedResult = Extract<
  MutableCodeGeneratorResult,
  { outcome: 'VALIDATION_REJECTED' }
>;

function rehashBundle(candidate: MutableGeneratedCodeBundle): void {
  for (const file of candidate.files) {
    file.byteLength = Buffer.byteLength(file.content, 'utf8');
    file.contentHash = calculateGeneratedContentHash(file.content);
    file.fileHash = calculateGeneratedFileHash(file);
  }
  candidate.bundleContentHash = calculateBundleContentHash(candidate.files);
  candidate.manifest.fileCount = candidate.files.length;
  candidate.manifest.totalBytes = candidate.files.reduce(
    (total, file) => total + file.byteLength,
    0,
  );
  candidate.manifest.entrypoints = [...candidate.entrypoints];
  candidate.manifest.files = candidate.files.map(projectGeneratedManifestFile);
  candidate.manifest.bundleContentHash = candidate.bundleContentHash;
  const manifestProjection = {
    bundleVersion: candidate.manifest.bundleVersion,
    contractVersion: candidate.manifest.contractVersion,
    fileCount: candidate.manifest.fileCount,
    totalBytes: candidate.manifest.totalBytes,
    entrypoints: candidate.manifest.entrypoints,
    files: candidate.manifest.files,
    bundleContentHash: candidate.manifest.bundleContentHash,
  };
  candidate.manifest.manifestHash = calculateGeneratedManifestHash(manifestProjection);
  candidate.lineage.files = candidate.files.map((file) => ({
    path: file.path,
    fileHash: file.fileHash,
    sourceModuleIds: [...file.sourceModuleIds],
    sourcePlanItemIds: [...file.sourcePlanItemIds],
  }));
  candidate.hashes.bundleContentHash = candidate.bundleContentHash;
  candidate.hashes.manifestHash = candidate.manifest.manifestHash;
  candidate.hashes.lineageHash = calculateCodeGenerationLineageHash(candidate.lineage);
  candidate.hashes.provenanceHash = calculateCodeGenerationProvenanceHash(candidate.provenance);
  candidate.hashes.bundleHash = calculateGeneratedBundleHash({
    bundleVersion: candidate.bundleVersion,
    contractVersion: candidate.contractVersion,
    technicalSpecificationHash: candidate.technicalSpecificationHash,
    bundleContentHash: candidate.bundleContentHash,
    manifestHash: candidate.hashes.manifestHash,
    lineageHash: candidate.hashes.lineageHash,
    provenanceHash: candidate.hashes.provenanceHash,
  });
  candidate.hashes.generationHash = calculateCodeGenerationHash({
    bundleVersion: candidate.bundleVersion,
    contractVersion: candidate.contractVersion,
    bundleHash: candidate.hashes.bundleHash,
    bundleContentHash: candidate.bundleContentHash,
    promptHash: candidate.provenance.promptHash,
    responseHash: candidate.provenance.responseHash,
    validationHash: candidate.provenance.validationHash,
    assetBundleHash: candidate.provenance.assetBundleHash,
  });
}

async function createHarness(options: HarnessOptions = {}) {
  const logLines: string[] = [];
  const logger = createLogger({ sink: (line) => logLines.push(line) });
  const source = new FakeKnowledgeSource({
    documents: {
      'code-generator.md':
        options.knowledgeContent ?? '# Code Generator\n\nGenerate only safe textual source files.',
    },
  });
  const defaultKnowledgeLoader = await createKnowledgeLoader({
    source,
    manifest: MANIFEST,
    policy: POLICY,
    logger,
  });
  const provider = new FakeAIProvider(
    options.outcomes ?? [{ type: 'success', response: createCodeGeneratorAIResponse() }],
  );
  const agentRunner = createAgentRunner({
    promptBuilder: createPromptBuilder({
      configuration: { maxBytes: CODE_GENERATOR_CONTRACT_LIMITS.request.promptBytes },
      logger,
    }),
    aiProvider: provider,
    logger,
  });
  const agent = createCodeGeneratorAgent({
    knowledgeLoader: options.knowledgeLoader ?? defaultKnowledgeLoader,
    agentRunner,
    responseValidator: options.responseValidator ?? createResponseValidator({ logger }),
    promptAssets: loadCodeGeneratorPromptAssets(),
    logger,
  });
  return { agent, logLines, provider, source };
}

describe('CodeGeneratorAgent', () => {
  it('executes the real local pipeline once and returns a server-authored immutable bundle', async () => {
    const { agent, provider } = await createHarness();
    const request = createCodeGenerationRequest();
    const snapshot = structuredClone(request);
    const controller = new AbortController();
    const result = await agent.execute(request, { signal: controller.signal });

    expect(result.outcome).toBe('GENERATED');
    if (result.outcome !== 'GENERATED') throw new Error('Expected generated result.');
    expect(result.bundle).toMatchObject({
      bundleVersion: '1.0.0',
      contractVersion: '1.0.0',
      entrypoints: ['core/order-query/index.ts'],
    });
    expect(result.bundle.files[0]).toMatchObject({
      path: 'core/order-query/index.ts',
      encoding: 'UTF-8',
      sourceModuleIds: ['MOD-001'],
      sourcePlanItemIds: ['PLAN-001'],
    });
    expect(result.bundle.files[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.bundle.technicalSpecificationHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.bundle.provenance.agent).toBe('CODE_GENERATOR');
    expect(result.bundle.provenance.approval).toEqual(request.approval);
    expect(result.metadata.generation.bundleContentHash).toBe(result.bundle.bundleContentHash);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.options.signal).toBe(controller.signal);
    expect(provider.calls[0]?.request.maxOutputTokens).toBe(131_072);
    expect(request).toEqual(snapshot);
    expect(Object.isFrozen(request)).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.bundle.files)).toBe(true);
    expect(Object.isFrozen(result.bundle.files[0])).toBe(true);
  });

  it('renders host-provided generation constraints into the real prompt input', async () => {
    const { agent, provider } = await createHarness();
    const generationProfile = projectGenerationProfileConstraints(
      NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE,
    );
    const request = createCodeGenerationRequest({
      generationConstraints: [
        {
          id: 'constraint:factory-profile-test',
          serialization: 'JSON',
          value: generationProfile as unknown as JsonValue,
        },
      ],
    });
    const snapshot = structuredClone(request);

    const result = await agent.execute(request);

    expect(result.outcome).toBe('GENERATED');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.request.input).toContain('sourceId: constraint:factory-profile-test');
    expect(provider.calls[0]?.request.input).toContain('"projectionVersion":"1.1.0"');
    expect(provider.calls[0]?.request.input).toContain('"suffixes":[".test.js",".test.ts"]');
    expect(provider.calls[0]?.request.input).toContain('"requiredEntrypoint":"index.html"');
    expect(provider.calls[0]?.request.input).toContain('"packageManager":"NONE"');
    expect(provider.calls[0]?.request.instructions).toContain('MUST obey every supplied rule');
    expect(provider.calls[0]?.request.instructions).toContain(
      'Um bundle que viole qualquer regra fornecida é inválido',
    );
    expect(result.metadata.assets.manifest.version).toBe('1.0.4');
    expect(result.metadata.run.prompt.metadata.version).toBe('1.0.4');
    expect(result.metadata.run.prompt.budget.usedBytes).toBeLessThanOrEqual(
      CODE_GENERATOR_CONTRACT_LIMITS.request.promptBytes,
    );
    expect(request).toEqual(snapshot);
    expect(Object.isFrozen(request)).toBe(false);
  });

  it('uses the explicit generic constraint only when the caller omits generation constraints', async () => {
    const { agent, provider } = await createHarness();

    await agent.execute(createCodeGenerationRequest());

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.request.input).toContain(
      'sourceId: constraint:generic-code-generation',
    );
    expect(provider.calls[0]?.request.input).toContain(
      'Nenhum profile específico do host foi fornecido',
    );
  });

  it('counts dynamic constraints against the prompt budget without truncation or provider calls', async () => {
    const { agent, provider } = await createHarness();
    const request = createCodeGenerationRequest({
      generationConstraints: [
        {
          id: 'constraint:oversized-profile',
          serialization: 'TEXT',
          value: 'x'.repeat(CODE_GENERATOR_CONTRACT_LIMITS.request.promptBytes),
        },
      ],
    });

    await expect(agent.execute(request)).rejects.toMatchObject({
      code: CODE_GENERATOR_AGENT_ERROR_CODES.RUN_FAILED,
      stage: 'RUNNER_EXECUTION',
      sourceCode: 'AGENT_RUN_PROMPT_BUILD_FAILED',
    });
    expect(provider.calls).toHaveLength(0);
  });

  it('uses the domain-separated interoperable content hash over binary-sorted descriptors', async () => {
    const base = createGeneratedCodeProposal().files[0]!;
    const proposal = createGeneratedCodeProposal({
      files: [
        { ...base, path: 'core/order-query/Á.ts', content: 'export const upper = true;\n' },
        { ...base, path: 'core/order-query/z.ts', content: 'export const zed = true;\n' },
      ],
      entrypoints: ['core/order-query/z.ts'],
    });
    const { agent } = await createHarness({
      outcomes: [{ type: 'success', response: createCodeGeneratorAIResponse(proposal) }],
    });
    const result = await agent.execute(createCodeGenerationRequest());
    if (result.outcome !== 'GENERATED') throw new Error('Expected generated result.');

    const projection = result.bundle.files.map((file) => ({
      path: file.path,
      encoding: file.encoding,
      mediaType: file.mediaType,
      purpose: file.purpose,
      byteLength: file.byteLength,
      contentHash: file.contentHash,
    }));
    expect(result.bundle.files.map((file) => file.path)).toEqual([
      'core/order-query/z.ts',
      'core/order-query/Á.ts',
    ]);
    expect(result.bundle.bundleContentHash).toBe(
      calculatePromptHash(
        `${CODE_BUNDLE_CONTENT_HASH_DOMAIN}${canonicalizeJson(projection as unknown as JsonValue)}`,
      ),
    );
  });

  it('rejects noncanonical file and entrypoint ordering at the public bundle boundary', async () => {
    const base = createGeneratedCodeProposal().files[0]!;
    const proposal = createGeneratedCodeProposal({
      files: [
        { ...base, path: 'core/order-query/a.ts', content: 'export const a = true;\n' },
        { ...base, path: 'core/order-query/b.ts', content: 'export const b = true;\n' },
      ],
      entrypoints: ['core/order-query/b.ts', 'core/order-query/a.ts'],
    });
    const { agent } = await createHarness({
      outcomes: [{ type: 'success', response: createCodeGeneratorAIResponse(proposal) }],
    });
    const result = await agent.execute(createCodeGenerationRequest());
    if (result.outcome !== 'GENERATED') throw new Error('Expected generated result.');

    const fileOrder = structuredClone(result.bundle) as unknown as MutableGeneratedCodeBundle;
    fileOrder.files.reverse();
    const entrypointOrder = structuredClone(result.bundle) as unknown as MutableGeneratedCodeBundle;
    entrypointOrder.entrypoints.reverse();

    expect(generatedCodeBundleSchema.safeParse(fileOrder).success).toBe(false);
    expect(generatedCodeBundleSchema.safeParse(entrypointOrder).success).toBe(false);
  });

  it('rejects an invalid approval envelope before Knowledge or provider execution', async () => {
    const request = createCodeGenerationRequest({
      approval: {
        ...createCodeGenerationRequest().approval,
        qaReadiness: 'PARTIALLY_READY' as never,
      },
    });
    const { agent, logLines, provider } = await createHarness();

    await expect(agent.execute(request)).rejects.toMatchObject({
      code: CODE_GENERATOR_AGENT_ERROR_CODES.INVALID_REQUEST,
      stage: 'REQUEST_VALIDATION',
      executionId: request.context.executionId,
    });
    expect(provider.calls).toHaveLength(0);
    expect(logLines.join('\n')).not.toContain(request.technicalSpecification.summary);
  });

  it.each([
    ['fileCount', (result: MutableGeneratedResult) => (result.metadata.generation.fileCount += 1)],
    [
      'totalBytes',
      (result: MutableGeneratedResult) => (result.metadata.generation.totalBytes += 1),
    ],
    [
      'bundleContentHash',
      (result: MutableGeneratedResult) =>
        (result.metadata.generation.bundleContentHash = '0'.repeat(64)),
    ],
    [
      'manifestHash',
      (result: MutableGeneratedResult) =>
        (result.metadata.generation.manifestHash = '0'.repeat(64)),
    ],
    [
      'lineageHash',
      (result: MutableGeneratedResult) => (result.metadata.generation.lineageHash = '0'.repeat(64)),
    ],
    [
      'provenanceHash',
      (result: MutableGeneratedResult) =>
        (result.metadata.generation.provenanceHash = '0'.repeat(64)),
    ],
    [
      'bundleHash',
      (result: MutableGeneratedResult) => (result.metadata.generation.bundleHash = '0'.repeat(64)),
    ],
    [
      'generationHash',
      (result: MutableGeneratedResult) =>
        (result.metadata.generation.generationHash = '0'.repeat(64)),
    ],
    [
      'manifest fileCount',
      (result: MutableGeneratedResult) => (result.bundle.manifest.fileCount += 1),
    ],
    [
      'manifest totalBytes',
      (result: MutableGeneratedResult) => (result.bundle.manifest.totalBytes += 1),
    ],
    [
      'technicalSpecificationHash',
      (result: MutableGeneratedResult) =>
        (result.metadata.technicalSpecificationHash = `sha256:${'0'.repeat(64)}`),
    ],
    [
      'declaredTechnicalSpecificationHash',
      (result: MutableGeneratedResult) =>
        (result.metadata.declaredTechnicalSpecificationHash = `sha256:${'0'.repeat(64)}`),
    ],
    [
      'approval',
      (result: MutableGeneratedResult) => (result.metadata.approval.workflowHash = '0'.repeat(64)),
    ],
    [
      'asset bundle',
      (result: MutableGeneratedResult) => (result.metadata.assets.bundleHash = '0'.repeat(64)),
    ],
    [
      'asset manifest',
      (result: MutableGeneratedResult) => (result.metadata.assets.manifest.hash = '0'.repeat(64)),
    ],
    [
      'template asset',
      (result: MutableGeneratedResult) => (result.metadata.assets.template.hash = '0'.repeat(64)),
    ],
    [
      'rule set asset',
      (result: MutableGeneratedResult) =>
        (result.metadata.assets.ruleSets[0]!.hash = '0'.repeat(64)),
    ],
    [
      'output contract asset',
      (result: MutableGeneratedResult) =>
        (result.metadata.assets.outputContract.hash = '0'.repeat(64)),
    ],
    [
      'validation contract asset',
      (result: MutableGeneratedResult) =>
        (result.metadata.assets.validationContract.hash = '0'.repeat(64)),
    ],
    [
      'knowledge hash',
      (result: MutableGeneratedResult) =>
        (result.metadata.knowledge.contextHash = `sha256:${'0'.repeat(64)}`),
    ],
    [
      'knowledge document',
      (result: MutableGeneratedResult) =>
        (result.metadata.knowledge.documents[0]!.hash = `sha256:${'0'.repeat(64)}`),
    ],
    [
      'prompt hash',
      (result: MutableGeneratedResult) =>
        (result.metadata.run.prompt.metadata.promptHash = '0'.repeat(64)),
    ],
    [
      'prompt agent',
      (result: MutableGeneratedResult) => (result.metadata.run.prompt.metadata.agent = 'DEVELOPER'),
    ],
    [
      'response hash',
      (result: MutableGeneratedResult) => (result.metadata.run.responseHash = '0'.repeat(64)),
    ],
    [
      'validation hash',
      (result: MutableGeneratedResult) =>
        (result.validation.response.metadata.validationHash = '0'.repeat(64)),
    ],
    [
      'provider',
      (result: MutableGeneratedResult) =>
        (result.metadata.run.provider.provider = 'different-provider'),
    ],
    [
      'model',
      (result: MutableGeneratedResult) =>
        (result.metadata.run.provider.responseModel = 'different-model'),
    ],
    ['agent version', (result: MutableGeneratedResult) => (result.context.agentVersion = '1.0.1')],
  ])('rejects generated-result %s metadata drift', async (_field, mutate) => {
    const { agent } = await createHarness();
    const result = await agent.execute(createCodeGenerationRequest());
    if (result.outcome !== 'GENERATED') throw new Error('Expected generated result.');
    const candidate = structuredClone(result) as unknown as MutableGeneratedResult;
    mutate(candidate);

    expect(codeGeneratorAgentResultSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects correlation and validation-state drift in rejected results', async () => {
    const { agent } = await createHarness({ outcomes: [{ type: 'malformed_json' }] });
    const result = await agent.execute(createCodeGenerationRequest());
    if (result.outcome !== 'VALIDATION_REJECTED') throw new Error('Expected rejected result.');

    const executionDrift = structuredClone(result) as unknown as MutableRejectedResult;
    executionDrift.context.executionId = 'another-execution';
    expect(codeGeneratorAgentResultSchema.safeParse(executionDrift).success).toBe(false);

    const specificationDrift = structuredClone(result) as unknown as MutableRejectedResult;
    specificationDrift.metadata.declaredTechnicalSpecificationHash = `sha256:${'0'.repeat(64)}`;
    expect(codeGeneratorAgentResultSchema.safeParse(specificationDrift).success).toBe(false);

    const stageDrift = structuredClone(result) as unknown as MutableRejectedResult;
    stageDrift.rejectedAt = 'BUSINESS_VALIDATION';
    expect(codeGeneratorAgentResultSchema.safeParse(stageDrift).success).toBe(false);

    const summaryDrift = structuredClone(result) as unknown as MutableRejectedResult;
    summaryDrift.validation.response.valid = true;
    expect(codeGeneratorAgentResultSchema.safeParse(summaryDrift).success).toBe(false);
  });

  it('preserves deterministic hashes for the same explicit response and source evidence', async () => {
    const response = createCodeGeneratorAIResponse();
    const { agent, provider } = await createHarness({
      outcomes: [
        { type: 'success', response },
        { type: 'success', response: structuredClone(response) },
      ],
    });
    const request = createCodeGenerationRequest();
    const first = await agent.execute(request);
    const second = await agent.execute(structuredClone(request));

    expect(first.outcome).toBe('GENERATED');
    expect(second.outcome).toBe('GENERATED');
    if (first.outcome !== 'GENERATED' || second.outcome !== 'GENERATED') return;
    expect(first.bundle.hashes).toEqual(second.bundle.hashes);
    expect(first.bundle.files).toEqual(second.bundle.files);
    expect(provider.calls).toHaveLength(2);
  });

  it.each([
    ['content', (bundle: MutableGeneratedCodeBundle) => (bundle.files[0]!.content += '// changed')],
    ['byteLength', (bundle: MutableGeneratedCodeBundle) => (bundle.files[0]!.byteLength += 1)],
    [
      'contentHash',
      (bundle: MutableGeneratedCodeBundle) => (bundle.files[0]!.contentHash = '0'.repeat(64)),
    ],
    [
      'fileHash',
      (bundle: MutableGeneratedCodeBundle) => (bundle.files[0]!.fileHash = '0'.repeat(64)),
    ],
    [
      'bundleContentHash',
      (bundle: MutableGeneratedCodeBundle) => (bundle.bundleContentHash = '0'.repeat(64)),
    ],
    [
      'manifest files',
      (bundle: MutableGeneratedCodeBundle) =>
        (bundle.manifest.files[0]!.path = 'core/order-query/changed.ts'),
    ],
    [
      'manifest entrypoints',
      (bundle: MutableGeneratedCodeBundle) =>
        (bundle.manifest.entrypoints[0] = 'core/order-query/changed.ts'),
    ],
    [
      'manifestHash',
      (bundle: MutableGeneratedCodeBundle) => (bundle.manifest.manifestHash = '0'.repeat(64)),
    ],
    [
      'lineage files',
      (bundle: MutableGeneratedCodeBundle) => (bundle.lineage.files[0]!.fileHash = '0'.repeat(64)),
    ],
    [
      'lineageHash',
      (bundle: MutableGeneratedCodeBundle) => (bundle.hashes.lineageHash = '0'.repeat(64)),
    ],
    [
      'provenanceHash',
      (bundle: MutableGeneratedCodeBundle) => (bundle.hashes.provenanceHash = '0'.repeat(64)),
    ],
    [
      'bundleHash',
      (bundle: MutableGeneratedCodeBundle) => (bundle.hashes.bundleHash = '0'.repeat(64)),
    ],
    [
      'generationHash',
      (bundle: MutableGeneratedCodeBundle) => (bundle.hashes.generationHash = '0'.repeat(64)),
    ],
  ])('rejects %s tampering through the public bundle schema', async (_field, mutate) => {
    const { agent } = await createHarness();
    const result = await agent.execute(createCodeGenerationRequest());
    if (result.outcome !== 'GENERATED') throw new Error('Expected generated result.');
    const candidate = structuredClone(result.bundle) as unknown as MutableGeneratedCodeBundle;
    mutate(candidate);

    expect(generatedCodeBundleSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects unsafe paths and secrets even when every server-authored hash is recomputed', async () => {
    const { agent } = await createHarness();
    const result = await agent.execute(createCodeGenerationRequest());
    if (result.outcome !== 'GENERATED') throw new Error('Expected generated result.');
    const unsafePath = structuredClone(result.bundle) as unknown as MutableGeneratedCodeBundle;
    unsafePath.files[0]!.path = '../escape.ts';
    unsafePath.entrypoints[0] = '../escape.ts';
    rehashBundle(unsafePath);

    const secretContent = structuredClone(result.bundle) as unknown as MutableGeneratedCodeBundle;
    secretContent.files[0]!.content = 'api_key = "secret-that-must-never-be-materialized";';
    rehashBundle(secretContent);

    for (const [candidate, issueCode] of [
      [unsafePath, 'UNSAFE_PATH'],
      [secretContent, 'SENSITIVE_CONTENT'],
    ] as const) {
      const parsed = generatedCodeBundleSchema.safeParse(candidate);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some((issue) => issue.message.includes(issueCode))).toBe(true);
      }
    }
  });

  it.each([
    [
      'calculated TechnicalSpecification hash',
      (bundle: MutableGeneratedCodeBundle) =>
        (bundle.lineage.technicalSpecificationHash = `sha256:${'7'.repeat(64)}`),
    ],
    [
      'declared TechnicalSpecification hash',
      (bundle: MutableGeneratedCodeBundle) =>
        (bundle.lineage.declaredTechnicalSpecificationHash = `sha256:${'9'.repeat(64)}`),
    ],
    [
      'QA approval hash',
      (bundle: MutableGeneratedCodeBundle) =>
        (bundle.lineage.qaSpecificationHash = `sha256:${'8'.repeat(64)}`),
    ],
  ])(
    'rejects re-hashed %s evidence that breaks cross-boundary correlation',
    async (_case, mutate) => {
      const { agent } = await createHarness();
      const result = await agent.execute(createCodeGenerationRequest());
      if (result.outcome !== 'GENERATED') throw new Error('Expected generated result.');
      const candidate = structuredClone(result.bundle) as unknown as MutableGeneratedCodeBundle;

      mutate(candidate);
      rehashBundle(candidate);

      expect(generatedCodeBundleSchema.safeParse(candidate).success).toBe(false);
    },
  );

  it('returns RESPONSE_VALIDATION rejection without a bundle for malformed provider output', async () => {
    const { agent, provider } = await createHarness({ outcomes: [{ type: 'malformed_json' }] });
    const result = await agent.execute(createCodeGenerationRequest());

    expect(result).toMatchObject({
      outcome: 'VALIDATION_REJECTED',
      rejectedAt: 'RESPONSE_VALIDATION',
      bundle: null,
      validation: { business: null },
      metadata: { generation: null },
    });
    expect(provider.calls).toHaveLength(1);
  });

  it('returns BUSINESS_VALIDATION rejection without silently fixing an unknown entrypoint', async () => {
    const proposal = createGeneratedCodeProposal({
      entrypoints: ['core/order-query/missing.ts'],
    });
    const { agent, provider } = await createHarness({
      outcomes: [{ type: 'success', response: createCodeGeneratorAIResponse(proposal) }],
    });
    const result = await agent.execute(createCodeGenerationRequest());

    expect(result).toMatchObject({
      outcome: 'VALIDATION_REJECTED',
      rejectedAt: 'BUSINESS_VALIDATION',
      bundle: null,
      metadata: { generation: null },
    });
    expect(result.validation.business?.issues.map((issue) => issue.code)).toContain(
      'CODE_GENERATOR_UNKNOWN_ENTRYPOINT',
    );
    expect(provider.calls).toHaveLength(1);
  });

  it('rejects an empty file in Business Validation and never reaches bundle assembly', async () => {
    const base = createGeneratedCodeProposal().files[0]!;
    const proposal = createGeneratedCodeProposal({ files: [{ ...base, content: '' }] });
    const { agent, provider } = await createHarness({
      outcomes: [{ type: 'success', response: createCodeGeneratorAIResponse(proposal) }],
    });

    const result = await agent.execute(createCodeGenerationRequest());

    expect(result).toMatchObject({
      outcome: 'VALIDATION_REJECTED',
      rejectedAt: 'BUSINESS_VALIDATION',
      bundle: null,
    });
    expect(result.validation.business?.issues.map((issue) => issue.code)).toContain(
      'CODE_GENERATOR_EMPTY_FILE_CONTENT',
    );
    expect(provider.calls).toHaveLength(1);
  });

  it.each([
    [
      'non-ready source',
      () => createCodeGeneratorTechnicalSpecification({ readiness: 'PARTIALLY_READY' }),
    ],
    [
      'MODIFY component',
      () => {
        const base = createCodeGeneratorTechnicalSpecification();
        return createCodeGeneratorTechnicalSpecification({
          components: base.components.map((component, index) =>
            index === 0 ? { ...component, changeType: 'MODIFY' } : component,
          ),
        });
      },
    ],
    [
      'DELETE module',
      () => {
        const base = createCodeGeneratorTechnicalSpecification();
        return createCodeGeneratorTechnicalSpecification({
          modules: base.modules.map((module, index) =>
            index === 0 ? { ...module, changeType: 'DELETE' } : module,
          ),
        });
      },
    ],
  ])(
    'rejects %s during source preflight before Knowledge and provider',
    async (_name, sourceFactory) => {
      const technicalSpecification = sourceFactory();
      const request = createCodeGenerationRequest({
        technicalSpecification,
        declaredTechnicalSpecificationHash: `sha256:${calculateCanonicalJsonHash(
          technicalSpecification as unknown as JsonValue,
        )}`,
      });
      const { agent, provider, source } = await createHarness();
      const sourceReadsBefore = source.readCalls.length;

      await expect(agent.execute(request)).rejects.toMatchObject({
        code: CODE_GENERATOR_AGENT_ERROR_CODES.SOURCE_NOT_APPROVED,
        stage: 'SOURCE_VALIDATION',
      });
      expect(provider.calls).toHaveLength(0);
      expect(source.readCalls).toHaveLength(sourceReadsBefore);
    },
  );

  it.each([
    ['space', 'core/order query'],
    ['unsupported punctuation', 'core/order-query?'],
    ['hidden segment', 'core/.hidden'],
    ['sensitive segment', 'core/node_modules'],
    ['Windows reserved segment', 'core/CON'],
    ['segment byte limit', `core/${'a'.repeat(256)}`],
    ['path depth limit', Array.from({ length: 21 }, (_, index) => `segment-${index}`).join('/')],
  ])('rejects a source module path with %s before Knowledge and provider', async (_name, path) => {
    const base = createCodeGeneratorTechnicalSpecification();
    const technicalSpecification = createCodeGeneratorTechnicalSpecification({
      modules: base.modules.map((module, index) => (index === 0 ? { ...module, path } : module)),
    });
    const request = createCodeGenerationRequest({
      technicalSpecification,
      declaredTechnicalSpecificationHash: `sha256:${calculateCanonicalJsonHash(
        technicalSpecification as unknown as JsonValue,
      )}`,
    });
    const { agent, provider, source } = await createHarness();
    const sourceReadsBefore = source.readCalls.length;

    await expect(agent.execute(request)).rejects.toMatchObject({
      code: CODE_GENERATOR_AGENT_ERROR_CODES.SOURCE_NOT_APPROVED,
      stage: 'SOURCE_VALIDATION',
    });
    expect(provider.calls).toHaveLength(0);
    expect(source.readCalls).toHaveLength(sourceReadsBefore);
  });

  it('rejects exact and NFKC-plus-case module path collisions during source preflight', async () => {
    for (const secondPath of ['core/order-query', 'CORE/ORDER-QUERY', 'core/ｏrder-query']) {
      const base = createCodeGeneratorTechnicalSpecification();
      const sourceModule = base.modules[0]!;
      const technicalSpecification = createCodeGeneratorTechnicalSpecification({
        modules: [
          sourceModule,
          {
            ...sourceModule,
            id: 'MOD-002',
            name: 'Colliding module path',
            path: secondPath,
          },
        ],
      });
      const request = createCodeGenerationRequest({
        technicalSpecification,
        declaredTechnicalSpecificationHash: `sha256:${calculateCanonicalJsonHash(
          technicalSpecification as unknown as JsonValue,
        )}`,
      });
      const { agent, provider, source } = await createHarness();
      const sourceReadsBefore = source.readCalls.length;

      await expect(agent.execute(request)).rejects.toMatchObject({
        code: CODE_GENERATOR_AGENT_ERROR_CODES.SOURCE_NOT_APPROVED,
        stage: 'SOURCE_VALIDATION',
      });
      expect(provider.calls).toHaveLength(0);
      expect(source.readCalls).toHaveLength(sourceReadsBefore);
    }
  });

  it('allows nested logical module roots when there is no exact portable collision', async () => {
    const base = createCodeGeneratorTechnicalSpecification();
    const sourceModule = base.modules[0]!;
    const technicalSpecification = createCodeGeneratorTechnicalSpecification({
      modules: [
        sourceModule,
        {
          ...sourceModule,
          id: 'MOD-002',
          name: 'Nested logical module',
          path: `${sourceModule.path}/generated`,
        },
      ],
    });
    const request = createCodeGenerationRequest({
      technicalSpecification,
      declaredTechnicalSpecificationHash: `sha256:${calculateCanonicalJsonHash(
        technicalSpecification as unknown as JsonValue,
      )}`,
    });
    const { agent, provider } = await createHarness({
      outcomes: [{ type: 'malformed_json' }],
    });

    const result = await agent.execute(request);

    expect(result).toMatchObject({
      outcome: 'VALIDATION_REJECTED',
      rejectedAt: 'RESPONSE_VALIDATION',
    });
    expect(provider.calls).toHaveLength(1);
  });

  it.each([
    [
      'declared TechnicalSpecification hash',
      () =>
        createCodeGenerationRequest({
          declaredTechnicalSpecificationHash: `sha256:${'0'.repeat(64)}`,
        }),
    ],
    [
      'approval execution',
      () =>
        createCodeGenerationRequest({
          approval: {
            ...createCodeGenerationRequest().approval,
            executionId: 'another-execution',
          },
        }),
    ],
  ])('rejects mismatched %s evidence before provider invocation', async (_case, requestFactory) => {
    const request = requestFactory();
    const { agent, provider } = await createHarness();

    await expect(agent.execute(request)).rejects.toMatchObject({
      code: CODE_GENERATOR_AGENT_ERROR_CODES.SOURCE_NOT_APPROVED,
      stage: 'SOURCE_VALIDATION',
    });
    expect(provider.calls).toHaveLength(0);
  });

  it('honors explicit prompt budget before provider and never truncates silently', async () => {
    const request = createCodeGenerationRequest({ limits: { promptMaxBytes: 1 } });
    const { agent, provider } = await createHarness();

    await expect(agent.execute(request)).rejects.toMatchObject({
      code: CODE_GENERATOR_AGENT_ERROR_CODES.RUN_FAILED,
      stage: 'RUNNER_EXECUTION',
      sourceCode: 'AGENT_RUN_PROMPT_BUILD_FAILED',
    });
    expect(provider.calls).toHaveLength(0);
  });

  it('fits representative Knowledge below 48 KiB and the complete source under 384 KiB', async () => {
    const content = `# Engineering\n\n${'x'.repeat(44 * 1024)}`;
    const { agent, provider } = await createHarness({ knowledgeContent: content });
    const result = await agent.execute(createCodeGenerationRequest());

    expect(result.outcome).toBe('GENERATED');
    expect(result.metadata.knowledge.budget.usedBytes).toBeLessThanOrEqual(48 * 1024);
    expect(result.metadata.run.prompt.budget.usedBytes).toBeLessThanOrEqual(384 * 1024);
    expect(provider.calls).toHaveLength(1);
  });

  it('propagates cancellation and does not retry a provider failure', async () => {
    const cancelled = await createHarness();
    const controller = new AbortController();
    controller.abort();
    await expect(
      cancelled.agent.execute(createCodeGenerationRequest(), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: CODE_GENERATOR_AGENT_ERROR_CODES.CANCELLED });
    expect(cancelled.provider.calls).toHaveLength(0);

    const failed = await createHarness({ outcomes: [{ type: 'transient_failure' }] });
    await expect(failed.agent.execute(createCodeGenerationRequest())).rejects.toMatchObject({
      code: CODE_GENERATOR_AGENT_ERROR_CODES.RUN_FAILED,
    });
    expect(failed.provider.calls).toHaveLength(1);
  });

  it.each([
    ['timeout', { type: 'timeout' } as const, CODE_GENERATOR_AGENT_ERROR_CODES.TIMEOUT],
    ['cancellation', { type: 'cancelled' } as const, CODE_GENERATOR_AGENT_ERROR_CODES.CANCELLED],
  ])('maps provider %s without retry', async (_case, outcome, expectedCode) => {
    const { agent, provider } = await createHarness({ outcomes: [outcome] });

    await expect(agent.execute(createCodeGenerationRequest())).rejects.toMatchObject({
      code: expectedCode,
      stage: 'RUNNER_EXECUTION',
    });
    expect(provider.calls).toHaveLength(1);
  });

  it('sanitizes a Response Validator exception and maps the validation stage', async () => {
    const sensitiveMessage = 'validator failure containing private response material';
    const responseValidator: ResponseValidator = {
      validate() {
        throw new ResponseValidatorError(sensitiveMessage, {
          code: RESPONSE_VALIDATOR_ERROR_CODES.INTERNAL_ERROR,
          stage: 'RESULT',
          durationMs: 1,
        });
      },
    };
    const { agent, logLines, provider } = await createHarness({ responseValidator });

    await expect(agent.execute(createCodeGenerationRequest())).rejects.toMatchObject({
      code: CODE_GENERATOR_AGENT_ERROR_CODES.VALIDATION_FAILED,
      stage: 'RESPONSE_VALIDATION',
      sourceCode: RESPONSE_VALIDATOR_ERROR_CODES.INTERNAL_ERROR,
    });
    expect(provider.calls).toHaveLength(1);
    expect(logLines.join('\n')).not.toContain(sensitiveMessage);
  });

  it('logs only allowlisted metadata and never logs source or generated content', async () => {
    const { agent, logLines } = await createHarness();
    const request = createCodeGenerationRequest();
    const secretSource = request.technicalSpecification.summary;
    const generatedContent = createGeneratedCodeProposal().files[0]!.content;
    await agent.execute(request);

    const logs = logLines.join('\n');
    expect(logs).toContain('code-generator.bundle.generated');
    expect(logs).toContain(request.declaredTechnicalSpecificationHash);
    expect(logs).not.toContain(secretSource);
    expect(logs).not.toContain(generatedContent);
    expect(logs).not.toContain('core/order-query/index.ts');
    expect(logs).not.toContain('TechnicalSpecification');
  });
});
