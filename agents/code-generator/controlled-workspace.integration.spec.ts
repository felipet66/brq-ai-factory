import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentRunner } from '@brq/agent-runner';
import {
  CONTROLLED_WORKSPACE_ERROR_CODES,
  ControlledWorkspaceError,
  type WorkspacePlanRequest,
} from '@brq/controlled-workspace';
import { createFilesystemControlledWorkspace } from '@brq/controlled-workspace/filesystem';
import { createKnowledgeLoader } from '@brq/knowledge-loader';
import { createPromptBuilder } from '@brq/prompt-builder';
import { createResponseValidator } from '@brq/response-validator';
import { createLogger } from '@brq/shared/logger/logger';
import { afterEach, describe, expect, it } from 'vitest';

import { FakeAIProvider } from '../../core/ai-provider/fake/fake-ai-provider';
import { FakeKnowledgeSource } from '../../core/knowledge-loader/testing/fake-knowledge-source';
import { createCodeGeneratorAgent } from './code-generator-agent';
import type { GeneratedCodeBundle } from './contracts';
import { CODE_GENERATOR_CONTRACT_LIMITS } from './limits';
import { loadCodeGeneratorPromptAssets } from './prompt-assets';
import {
  createCodeGenerationRequest,
  createCodeGeneratorAIResponse,
  createGeneratedCodeProposal,
} from './testing/code-generator-fixtures';

const EMPTY_SELECTION = { required: [], optional: [] } as const;
const KNOWLEDGE_MANIFEST = {
  version: '1.0.0',
  documents: [
    {
      id: 'knowledge:code-generator-integration',
      locator: 'code-generator.md',
      category: 'ENGINEERING',
      order: 1,
    },
  ],
} as const;
const KNOWLEDGE_POLICY = {
  version: '1.0.0',
  contexts: {
    GLOBAL: EMPTY_SELECTION,
    PRODUCT_OWNER: EMPTY_SELECTION,
    DEVELOPER: EMPTY_SELECTION,
    QA: EMPTY_SELECTION,
    CODE_GENERATOR: {
      required: ['knowledge:code-generator-integration'],
      optional: [],
    },
    SECURITY: EMPTY_SELECTION,
    ARCHITECTURE: EMPTY_SELECTION,
  },
} as const;

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })),
  );
});

function projectBundle(bundle: GeneratedCodeBundle): WorkspacePlanRequest {
  return {
    source: {
      technicalSpecificationHash: bundle.technicalSpecificationHash,
      generationHash: bundle.hashes.generationHash,
      bundleHash: bundle.hashes.bundleHash,
      bundleContentHash: bundle.bundleContentHash,
      bundleVersion: bundle.bundleVersion,
      contractVersion: bundle.contractVersion,
    },
    files: bundle.files.map((file) => ({
      path: file.path,
      content: file.content,
      encoding: file.encoding,
      mediaType: file.mediaType,
      purpose: file.purpose,
      byteLength: file.byteLength,
      contentHash: file.contentHash,
    })),
  };
}

async function generateBundle(): Promise<{
  readonly bundle: GeneratedCodeBundle;
  readonly provider: FakeAIProvider;
}> {
  const logger = createLogger({ sink: () => undefined });
  const knowledgeLoader = await createKnowledgeLoader({
    source: new FakeKnowledgeSource({
      documents: {
        'code-generator.md': '# Integration\n\nGenerate only safe textual source files.',
      },
    }),
    manifest: KNOWLEDGE_MANIFEST,
    policy: KNOWLEDGE_POLICY,
    logger,
  });
  const proposal = createGeneratedCodeProposal({
    files: [
      {
        path: 'core/order-query/á.ts',
        content: 'export const accented = true;\n',
        encoding: 'UTF-8',
        mediaType: 'text/typescript',
        purpose: 'SOURCE',
        sourceModuleIds: ['MOD-001'],
        sourcePlanItemIds: ['PLAN-001'],
      },
      {
        path: 'core/order-query/Z.test.ts',
        content: 'export const verified = true;\n',
        encoding: 'UTF-8',
        mediaType: 'text/typescript',
        purpose: 'TEST',
        sourceModuleIds: ['MOD-001'],
        sourcePlanItemIds: ['PLAN-001'],
      },
    ],
    entrypoints: ['core/order-query/á.ts'],
  });
  const provider = new FakeAIProvider([
    { type: 'success', response: createCodeGeneratorAIResponse(proposal) },
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

  const result = await agent.execute(createCodeGenerationRequest());
  expect(result.outcome).toBe('GENERATED');
  if (result.outcome !== 'GENERATED') throw new Error('Expected generated code bundle.');
  return { bundle: result.bundle, provider };
}

describe('Code Generator to Controlled Workspace handoff', () => {
  it('preserves the public hash chain and atomically materializes the projected bundle', async () => {
    const { bundle, provider } = await generateBundle();
    const rootPath = await mkdtemp(path.join(tmpdir(), 'brq-code-handoff-'));
    temporaryRoots.push(rootPath);
    const workspace = createFilesystemControlledWorkspace({ rootPath });

    const plan = workspace.plan(projectBundle(bundle));
    const result = await workspace.materialize(plan);

    expect(provider.calls).toHaveLength(1);
    expect(plan.source.bundleContentHash).toBe(bundle.bundleContentHash);
    expect(result.source.bundleHash).toBe(bundle.hashes.bundleHash);
    expect(result.lineage.technicalSpecificationHash).toBe(bundle.technicalSpecificationHash);
    expect(result.lineage.bundleContentHash).toBe(bundle.bundleContentHash);
    expect(plan.files.map(({ path: filePath }) => filePath)).toEqual([
      'core/order-query/Z.test.ts',
      'core/order-query/á.ts',
    ]);
    await expect(
      readFile(path.join(rootPath, result.workspaceId, 'core/order-query/á.ts'), 'utf8'),
    ).resolves.toBe('export const accented = true;\n');
  });

  it('rejects a tampered projection before materialization without correcting it', async () => {
    const { bundle, provider } = await generateBundle();
    const rootPath = await mkdtemp(path.join(tmpdir(), 'brq-code-handoff-'));
    temporaryRoots.push(rootPath);
    const workspace = createFilesystemControlledWorkspace({ rootPath });
    const request = projectBundle(bundle);
    const firstFile = request.files[0];
    if (firstFile === undefined) throw new Error('Expected projected file.');

    expect(() =>
      workspace.plan({
        ...request,
        files: [
          { ...firstFile, content: `${firstFile.content}tampered` },
          ...request.files.slice(1),
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ControlledWorkspaceError>>({
        code: CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_REQUEST,
      }),
    );
    expect(provider.calls).toHaveLength(1);
  });
});
