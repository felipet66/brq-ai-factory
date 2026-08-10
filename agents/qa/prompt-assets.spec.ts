import { calculateCanonicalJsonHash } from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import historicalArtifactSpecification from '../../prompts/qa/1.0.0/artifact-specification.json' with { type: 'json' };
import historicalGlobalRules from '../../prompts/qa/1.0.0/global-rules.json' with { type: 'json' };
import historicalManifest from '../../prompts/qa/1.0.0/manifest.json' with { type: 'json' };
import historicalOutputContract from '../../prompts/qa/1.0.0/output-contract.json' with { type: 'json' };
import historicalQARules from '../../prompts/qa/1.0.0/qa-rules.json' with { type: 'json' };
import historicalSecurityRules from '../../prompts/qa/1.0.0/security-rules.json' with { type: 'json' };
import historicalTemplate from '../../prompts/qa/1.0.0/template.json' with { type: 'json' };
import rawArtifactSpecification from '../../prompts/qa/1.0.1/artifact-specification.json' with { type: 'json' };
import rawGlobalRules from '../../prompts/qa/1.0.1/global-rules.json' with { type: 'json' };
import rawManifest from '../../prompts/qa/1.0.1/manifest.json' with { type: 'json' };
import rawOutputContract from '../../prompts/qa/1.0.1/output-contract.json' with { type: 'json' };
import rawQARules from '../../prompts/qa/1.0.1/qa-rules.json' with { type: 'json' };
import rawSecurityRules from '../../prompts/qa/1.0.1/security-rules.json' with { type: 'json' };
import rawTemplate from '../../prompts/qa/1.0.1/template.json' with { type: 'json' };
import {
  QAPromptAssetsError,
  loadQAPromptAssets,
  parseQAPromptAssets,
  qaPromptAssetManifestSchema,
  validateQAPromptAssets,
  type QAPromptAssetSources,
} from './prompt-assets';

const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const QA_BUNDLE_1_0_1_HASH = '618302c7dc8ddcec7c7087789e966a74259631d4a716d125c9adefa8a5c665b9';
const HISTORICAL_QA_1_0_0_HASHES = {
  manifest: 'ddd0764de3ab70d04f1dae13469f083c5f9bf800ba71dcb2ed914fe714e5b12c',
  template: '35fed535f109803f4dd03880e1a9399a2bb8a66f147b2a14b1e9a233b7ca9af3',
  globalRules: 'eaa5d555158cdba2cb5229d81a7917d5e0d8d0591b309c9229195fbdbf8f2715',
  securityRules: '0177cbe77feaa7ef6a46b414c0ea6fc025fabc3aa84e9ece98c7cf126478fbbc',
  qaRules: '0b8f8ac0b1a3bd8c7663c9b0ce3e0ccd6aeda3b8d6cefa5cd3866ba8c90076be',
  outputContract: 'c9c3947fc4f902767f767e971452aefb747aaea8ca6bc16c7f8aca3bd60d3c69',
  artifactSpecification: 'a7b9bec83f56f1e74097de6844a0d7527acb4e476c1957930a7341ae7da623be',
} as const;
const QA_SCHEMA_HASH = '46c050a9974e7a5723887f8b007e6367cedac613873cbe066a2f97138caf0b70';

function createSources(): QAPromptAssetSources {
  return structuredClone({
    manifest: rawManifest,
    template: rawTemplate,
    globalRules: rawGlobalRules,
    securityRules: rawSecurityRules,
    qaRules: rawQARules,
    outputContract: rawOutputContract,
    artifactSpecification: rawArtifactSpecification,
  });
}

function qaRuleContent(id: string): string {
  const rule = rawQARules.rules.find((candidate) => candidate.id === id);
  if (rule === undefined) throw new Error(`Expected QA rule ${id}.`);
  return rule.content;
}

function finalInstructionContent(): string {
  const section = rawTemplate.sections.find(({ kind }) => kind === 'FINAL_INSTRUCTION');
  const fragments = section?.blocks.flatMap(({ fragments }) => fragments) ?? [];
  const text = fragments.find(
    (fragment) => 'value' in fragment && typeof fragment.value === 'string',
  );
  if (text === undefined || !('value' in text) || typeof text.value !== 'string') {
    throw new Error('Expected the QA final instruction text.');
  }
  return text.value;
}

describe('QA prompt assets', () => {
  it('carrega o bundle QA 1.0.1 imutável e autocontido', () => {
    const assets = loadQAPromptAssets();

    expect(assets.manifest).toMatchObject({
      id: 'assets:qa',
      version: '1.0.1',
      schemaVersion: '1.0.0',
      agent: 'QA',
    });
    expect(assets.template.version).toBe('1.0.1');
    expect(assets.ruleSets.map(({ id, version }) => ({ id, version }))).toEqual([
      { id: 'rules:global-baseline', version: '1.0.0' },
      { id: 'rules:security-baseline', version: '1.0.0' },
      { id: 'rules:qa', version: '1.0.1' },
    ]);
    expect(assets.outputContract.version).toBe('1.0.1');
    expect(assets.validationContract.version).toBe('1.0.1');
    expect(assets.artifactSpecification.version).toBe('1.0.1');
    expect(assets.hashes.bundleHash).toBe(QA_BUNDLE_1_0_1_HASH);
    expect(loadQAPromptAssets()).toBe(assets);
    expect(Object.isFrozen(assets)).toBe(true);
    expect(Object.isFrozen(assets.template.sections)).toBe(true);
  });

  it('preserva integralmente o release histórico QA 1.0.0', () => {
    const historicalHashes = {
      manifest: calculateCanonicalJsonHash(historicalManifest as unknown as JsonValue),
      template: calculateCanonicalJsonHash(historicalTemplate as unknown as JsonValue),
      globalRules: calculateCanonicalJsonHash(historicalGlobalRules as unknown as JsonValue),
      securityRules: calculateCanonicalJsonHash(historicalSecurityRules as unknown as JsonValue),
      qaRules: calculateCanonicalJsonHash(historicalQARules as unknown as JsonValue),
      outputContract: calculateCanonicalJsonHash(historicalOutputContract as unknown as JsonValue),
      artifactSpecification: calculateCanonicalJsonHash(
        historicalArtifactSpecification as unknown as JsonValue,
      ),
    };

    expect(historicalManifest.version).toBe('1.0.0');
    expect(historicalHashes).toEqual(HISTORICAL_QA_1_0_0_HASHES);
    expect(rawManifest.version).toBe('1.0.1');
    expect(rawGlobalRules).toEqual(historicalGlobalRules);
    expect(rawSecurityRules).toEqual(historicalSecurityRules);
    expect(rawOutputContract.schema).toEqual(historicalOutputContract.schema);
    expect(calculateCanonicalJsonHash(rawOutputContract.schema as unknown as JsonValue)).toBe(
      QA_SCHEMA_HASH,
    );
  });

  it('produz hashes canônicos determinísticos e preserva a ordem dos assets', () => {
    const first = parseQAPromptAssets(createSources());
    const second = parseQAPromptAssets(createSources());
    const hashes = [
      first.hashes.manifestHash,
      first.hashes.templateHash,
      ...first.hashes.ruleSetHashes.map(({ hash }) => hash),
      first.hashes.outputContractHash,
      first.hashes.validationContractHash,
      first.hashes.artifactSpecificationHash,
      first.hashes.bundleHash,
    ];

    expect(first.hashes).toEqual(second.hashes);
    expect(first.hashes.bundleHash).toBe(QA_BUNDLE_1_0_1_HASH);
    expect(hashes).toHaveLength(9);
    expect(hashes.every((hash) => SHA_256_HEX_PATTERN.test(hash))).toBe(true);
    expect(first.artifactSpecification.sourceContract.contractHash).toBe(
      first.hashes.validationContractHash,
    );
  });

  it('declara os três contextos dinâmicos como INPUT e UNTRUSTED na ordem canônica', () => {
    const assets = loadQAPromptAssets();
    expect(assets.manifest.contexts).toEqual({
      knowledge: 'context:qa-knowledge',
      productOwnerSpecification: 'context:qa-product-owner-specification',
      technicalSpecification: 'context:qa-technical-specification',
    });
    const sections = assets.template.sections.filter((section) =>
      section.blocks.some((block) =>
        block.fragments.some((fragment) => fragment.type === 'CONTEXT_SLOT'),
      ),
    );
    const contextIds = sections.flatMap((section) =>
      section.blocks.flatMap((block) =>
        block.fragments.flatMap((fragment) =>
          fragment.type === 'CONTEXT_SLOT' ? [fragment.contextId] : [],
        ),
      ),
    );

    expect(contextIds).toEqual(Object.values(assets.manifest.contexts));
    expect(sections).toHaveLength(3);
    expect(
      sections.every(({ channel, trust }) => channel === 'INPUT' && trust === 'UNTRUSTED'),
    ).toBe(true);
  });

  it('mantém o JSON Schema público conservador e inalterado', () => {
    const contract = loadQAPromptAssets().outputContract;
    const serialized = JSON.stringify(contract.schema);

    expect(contract.format).toBe('JSON_SCHEMA');
    expect(serialized).not.toContain('"$schema"');
    expect(serialized).not.toContain('"uniqueItems"');
    expect(contract.schema).toEqual(historicalOutputContract.schema);
    expect(contract.schema).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it('explicita a consistência relacional de coverage e matrix em todos os limites do prompt', () => {
    const sources = [
      [
        qaRuleContent('qa:functional-coverage'),
        qaRuleContent('qa:technical-coverage'),
        qaRuleContent('qa:scenario-categories'),
      ].join('\n'),
      rawOutputContract.instructions.join('\n'),
      finalInstructionContent(),
    ];

    for (const source of sources) {
      expect(source).toContain('functionalCoverage');
      expect(source).toContain('technicalCoverage');
      expect(source).toContain('functionalReferences');
      expect(source).toContain('technicalReferences');
      expect(source).toContain('matrix');
      expect(source).toContain('scenario');
    }
    expect(qaRuleContent('qa:functional-coverage')).toContain(
      'outros IDs funcionais válidos MAY coexistir',
    );
    expect(qaRuleContent('qa:technical-coverage')).toContain(
      'outros IDs técnicos válidos MAY coexistir',
    );
    expect(qaRuleContent('qa:scenario-categories')).toContain(
      'ao menos uma fonte da própria linha',
    );
  });

  it('explicita a tabela autoritativa de readiness na ordem correta em todos os limites', () => {
    const sources = [
      qaRuleContent('qa:deterministic-readiness'),
      rawOutputContract.instructions.join('\n'),
      finalInstructionContent(),
    ];
    const orderedMarkers = [
      'productOwnerSpecification.readiness === "REQUIRES_CLARIFICATION"',
      'blockingItems.length > 0',
      'openQuestions[].impact === "BLOCKING"',
      'productOwnerSpecification.readiness === "PARTIALLY_READY"',
      'openQuestions.length > 0 OR qualquer assumptions[].requiresValidation === true',
      'ELSE readiness MUST ser "READY"',
    ];

    for (const source of sources) {
      let previousIndex = -1;
      for (const marker of orderedMarkers) {
        const markerIndex = source.indexOf(marker);
        expect(markerIndex).toBeGreaterThan(previousIndex);
        previousIndex = markerIndex;
      }
      expect(source).toContain('technicalSpecification.readiness');
      expect(source).toContain('requiresValidation === false');
      expect(source).toContain('campo readiness');
    }
  });

  it('deriva o Validation Contract e mantém os três artifacts canônicos', () => {
    const assets = loadQAPromptAssets();
    expect(assets.validationContract).toMatchObject({
      id: assets.outputContract.id,
      version: assets.outputContract.version,
      expectedOutputContractHash: assets.hashes.outputContractHash,
    });
    expect(assets.artifactSpecification.sourceContract.contractHash).toBe(
      assets.hashes.validationContractHash,
    );
    expect(
      assets.artifactSpecification.templates.map(({ id, filename, type, format }) => ({
        id,
        filename,
        type,
        format,
      })),
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

  it('rejeita drift em manifesto, regra, contrato e hashes injetados', () => {
    const assets = loadQAPromptAssets();
    const manifest = structuredClone(rawManifest);
    manifest.contexts.technicalSpecification = manifest.contexts.knowledge;
    const qaRules = structuredClone(rawQARules);
    qaRules.rules[0]!.content = 'regra adulterada';

    expect(qaPromptAssetManifestSchema.safeParse(manifest).success).toBe(false);
    expect(() => parseQAPromptAssets({ ...createSources(), qaRules })).toThrow(QAPromptAssetsError);
    expect(() =>
      validateQAPromptAssets({
        ...assets,
        hashes: { ...assets.hashes, bundleHash: '0'.repeat(64) },
      }),
    ).toThrow(QAPromptAssetsError);
  });
});
