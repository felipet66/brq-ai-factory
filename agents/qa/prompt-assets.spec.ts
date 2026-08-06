import { describe, expect, it } from 'vitest';

import {
  QAPromptAssetsError,
  loadQAPromptAssets,
  parseQAPromptAssets,
  qaPromptAssetManifestSchema,
  validateQAPromptAssets,
  type QAPromptAssets,
} from './prompt-assets';

function sources(assets: QAPromptAssets) {
  return {
    manifest: assets.manifest,
    template: assets.template,
    globalRules: assets.ruleSets[0],
    securityRules: assets.ruleSets[1],
    qaRules: assets.ruleSets[2],
    outputContract: assets.outputContract,
    artifactSpecification: assets.artifactSpecification,
  };
}

describe('QA prompt assets', () => {
  it('carrega o bundle 1.0.0 imutável com hashes fixos', () => {
    const assets = loadQAPromptAssets();
    expect(assets.manifest.id).toBe('assets:qa');
    expect(assets.manifest.version).toBe('1.0.0');
    expect(assets.hashes.bundleHash).toBe(
      'c674db967cd7af9c8e2471fc1b546edbc5ea3133e0c846171e943bc48fdff693',
    );
    expect(assets.hashes.ruleSetHashes).toHaveLength(3);
    expect(Object.isFrozen(assets)).toBe(true);
    expect(Object.isFrozen(assets.template.sections)).toBe(true);
  });

  it('declara os três contextos distintos na ordem canônica do template', () => {
    const assets = loadQAPromptAssets();
    expect(assets.manifest.contexts).toEqual({
      knowledge: 'context:qa-knowledge',
      productOwnerSpecification: 'context:qa-product-owner-specification',
      technicalSpecification: 'context:qa-technical-specification',
    });
    const contextIds = assets.template.sections.flatMap((section) =>
      section.blocks.flatMap((block) =>
        block.fragments.flatMap((fragment) =>
          fragment.type === 'CONTEXT_SLOT' ? [fragment.contextId] : [],
        ),
      ),
    );
    expect(contextIds).toEqual(Object.values(assets.manifest.contexts));
  });

  it('mantém todos os contextos dinâmicos como INPUT e UNTRUSTED', () => {
    const sections = loadQAPromptAssets().template.sections.filter((section) =>
      section.blocks.some((block) =>
        block.fragments.some((fragment) => fragment.type === 'CONTEXT_SLOT'),
      ),
    );
    expect(sections).toHaveLength(3);
    expect(
      sections.every(({ channel, trust }) => channel === 'INPUT' && trust === 'UNTRUSTED'),
    ).toBe(true);
  });

  it('usa JSON_SCHEMA conservador sem propriedades incompatíveis', () => {
    const contract = loadQAPromptAssets().outputContract;
    expect(contract.format).toBe('JSON_SCHEMA');
    const serialized = JSON.stringify(contract.schema);
    expect(serialized).not.toContain('"$schema"');
    expect(serialized).not.toContain('"uniqueItems"');
    expect(contract.schema).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it('deriva o Validation Contract do Output Contract', () => {
    const assets = loadQAPromptAssets();
    expect(assets.validationContract.id).toBe(assets.outputContract.id);
    expect(assets.validationContract.version).toBe(assets.outputContract.version);
    expect(assets.validationContract.expectedOutputContractHash).toBe(
      assets.hashes.outputContractHash,
    );
    expect(assets.artifactSpecification.sourceContract.contractHash).toBe(
      assets.hashes.validationContractHash,
    );
  });

  it('produz somente os três artifacts canônicos', () => {
    expect(
      loadQAPromptAssets().artifactSpecification.templates.map(
        ({ id, filename, type, format }) => ({ id, filename, type, format }),
      ),
    ).toEqual([
      {
        id: 'artifact:qa-test-plan',
        filename: 'test-plan.md',
        type: 'QA_TEST_PLAN',
        format: 'TEXT',
      },
      {
        id: 'artifact:qa-traceability-matrix',
        filename: 'traceability-matrix.json',
        type: 'QA_TRACEABILITY_MATRIX',
        format: 'JSON',
      },
      {
        id: 'artifact:qa-specification',
        filename: 'qa-specification.md',
        type: 'QA_SPECIFICATION',
        format: 'TEXT',
      },
    ]);
  });

  it('rejeita IDs de contexto repetidos no manifesto', () => {
    const original = loadQAPromptAssets().manifest;
    const manifest = {
      ...original,
      contexts: { ...original.contexts, technicalSpecification: original.contexts.knowledge },
    };
    expect(qaPromptAssetManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it('rejeita drift em regra, contrato ou hashes injetados', () => {
    const assets = loadQAPromptAssets();
    const originalRules = assets.ruleSets[2]!;
    const qaRules = {
      ...originalRules,
      rules: originalRules.rules.map((rule, index) =>
        index === 0 ? { ...rule, content: 'regra adulterada' } : rule,
      ),
    };
    expect(() => parseQAPromptAssets({ ...sources(assets), qaRules })).toThrow(QAPromptAssetsError);
    expect(() =>
      validateQAPromptAssets({
        ...assets,
        hashes: { ...assets.hashes, bundleHash: '0'.repeat(64) },
      }),
    ).toThrow(QAPromptAssetsError);
  });
});
