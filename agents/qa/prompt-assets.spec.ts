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
import historical101ArtifactSpecification from '../../prompts/qa/1.0.1/artifact-specification.json' with { type: 'json' };
import historical101GlobalRules from '../../prompts/qa/1.0.1/global-rules.json' with { type: 'json' };
import historical101Manifest from '../../prompts/qa/1.0.1/manifest.json' with { type: 'json' };
import historical101OutputContract from '../../prompts/qa/1.0.1/output-contract.json' with { type: 'json' };
import historical101QARules from '../../prompts/qa/1.0.1/qa-rules.json' with { type: 'json' };
import historical101SecurityRules from '../../prompts/qa/1.0.1/security-rules.json' with { type: 'json' };
import historical101Template from '../../prompts/qa/1.0.1/template.json' with { type: 'json' };
import historical102ArtifactSpecification from '../../prompts/qa/1.0.2/artifact-specification.json' with { type: 'json' };
import historical102GlobalRules from '../../prompts/qa/1.0.2/global-rules.json' with { type: 'json' };
import historical102Manifest from '../../prompts/qa/1.0.2/manifest.json' with { type: 'json' };
import historical102OutputContract from '../../prompts/qa/1.0.2/output-contract.json' with { type: 'json' };
import historical102QARules from '../../prompts/qa/1.0.2/qa-rules.json' with { type: 'json' };
import historical102SecurityRules from '../../prompts/qa/1.0.2/security-rules.json' with { type: 'json' };
import historical102Template from '../../prompts/qa/1.0.2/template.json' with { type: 'json' };
import historical103ArtifactSpecification from '../../prompts/qa/1.0.3/artifact-specification.json' with { type: 'json' };
import historical103GlobalRules from '../../prompts/qa/1.0.3/global-rules.json' with { type: 'json' };
import historical103Manifest from '../../prompts/qa/1.0.3/manifest.json' with { type: 'json' };
import historical103OutputContract from '../../prompts/qa/1.0.3/output-contract.json' with { type: 'json' };
import historical103QARules from '../../prompts/qa/1.0.3/qa-rules.json' with { type: 'json' };
import historical103SecurityRules from '../../prompts/qa/1.0.3/security-rules.json' with { type: 'json' };
import historical103Template from '../../prompts/qa/1.0.3/template.json' with { type: 'json' };
import rawArtifactSpecification from '../../prompts/qa/1.0.4/artifact-specification.json' with { type: 'json' };
import rawGlobalRules from '../../prompts/qa/1.0.4/global-rules.json' with { type: 'json' };
import rawManifest from '../../prompts/qa/1.0.4/manifest.json' with { type: 'json' };
import rawOutputContract from '../../prompts/qa/1.0.4/output-contract.json' with { type: 'json' };
import rawQARules from '../../prompts/qa/1.0.4/qa-rules.json' with { type: 'json' };
import rawSecurityRules from '../../prompts/qa/1.0.4/security-rules.json' with { type: 'json' };
import rawTemplate from '../../prompts/qa/1.0.4/template.json' with { type: 'json' };
import {
  QAPromptAssetsError,
  loadQAPromptAssets,
  parseQAPromptAssets,
  qaPromptAssetManifestSchema,
  validateQAPromptAssets,
  type QAPromptAssetSources,
} from './prompt-assets';

const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const QA_BUNDLE_1_0_4_HASH = 'd72d8c454438a3a523e9aa034211a171db12ac49e0a2736f12d4139fe6fb20bd';
const HISTORICAL_QA_1_0_0_HASHES = {
  manifest: 'ddd0764de3ab70d04f1dae13469f083c5f9bf800ba71dcb2ed914fe714e5b12c',
  template: '35fed535f109803f4dd03880e1a9399a2bb8a66f147b2a14b1e9a233b7ca9af3',
  globalRules: 'eaa5d555158cdba2cb5229d81a7917d5e0d8d0591b309c9229195fbdbf8f2715',
  securityRules: '0177cbe77feaa7ef6a46b414c0ea6fc025fabc3aa84e9ece98c7cf126478fbbc',
  qaRules: '0b8f8ac0b1a3bd8c7663c9b0ce3e0ccd6aeda3b8d6cefa5cd3866ba8c90076be',
  outputContract: 'c9c3947fc4f902767f767e971452aefb747aaea8ca6bc16c7f8aca3bd60d3c69',
  artifactSpecification: 'a7b9bec83f56f1e74097de6844a0d7527acb4e476c1957930a7341ae7da623be',
} as const;
const HISTORICAL_QA_1_0_1_HASHES = {
  manifest: '4ef88cee04e2900c936f576a7eeb8c9efd58b77e8304680c5ce55346597c79e8',
  template: 'd9b57c79b659fdba3037e8b73f5a0e7ae9290dab246cca9b8b9b479b908da73d',
  globalRules: 'eaa5d555158cdba2cb5229d81a7917d5e0d8d0591b309c9229195fbdbf8f2715',
  securityRules: '0177cbe77feaa7ef6a46b414c0ea6fc025fabc3aa84e9ece98c7cf126478fbbc',
  qaRules: '739d26183acc4f1422157b97d62d25114b1ac7a63e6804b6790b58572a33f9ec',
  outputContract: '4361e4fd89b338370277f8142f960e9844ea2468e00e10c889a5461480545451',
  validationContract: '8b75b618b1e0c5f1d6bc9662262056a572143a4ebf8883ac39ff74c68434be4d',
  artifactSpecification: '8d67226f4caa661e290088532620fca4807c15930cc0959d6a05fb77f1d6407b',
  bundle: '618302c7dc8ddcec7c7087789e966a74259631d4a716d125c9adefa8a5c665b9',
} as const;
const HISTORICAL_QA_1_0_2_HASHES = {
  manifest: 'bac9c6257b0b5eba0fc645c4ede25a5cdd426654a00ded8d14387594fef356ff',
  template: '948a6a4232b1c23b04640205f23d1001cba2e90144eb84444e5ee1966160b540',
  globalRules: 'eaa5d555158cdba2cb5229d81a7917d5e0d8d0591b309c9229195fbdbf8f2715',
  securityRules: '0177cbe77feaa7ef6a46b414c0ea6fc025fabc3aa84e9ece98c7cf126478fbbc',
  qaRules: '58e13abd85cdb3066697b92a429a25e3f7513cf7ed0eca7f3323be97d053a49a',
  outputContract: '7d0538f8c6a2cb9d268eb352f12c82db86cd80adad8f106191045f1a20694884',
  validationContract: 'ee0a50db4db301389768a1a79d68d1a1a5fc0520fc9ce5fd33afa111561b10ea',
  artifactSpecification: '49dfdddbf60a0a80033bf2c3fa2ea18383b8a0390b4fa8efb3e533bc6b72fdad',
  bundle: 'ffd4f29dc2131872c320ee1cd56b96eaef23962591327d12e441d2769cfaa4e1',
} as const;
const HISTORICAL_QA_1_0_3_HASHES = {
  manifest: '1f1bf7b5527d399aa49baed2d29cc0a45d27167d1fe4f41422c190a67c57f942',
  template: '8079c65ae86c53a5b4588f90781054fe597524c57659fbcdd67c0b30d12de5ee',
  globalRules: 'eaa5d555158cdba2cb5229d81a7917d5e0d8d0591b309c9229195fbdbf8f2715',
  securityRules: '0177cbe77feaa7ef6a46b414c0ea6fc025fabc3aa84e9ece98c7cf126478fbbc',
  qaRules: '1bf1c0155c527fb3a875224a28a00abd4287f09cabb31714a6ad7aacabb9ae48',
  outputContract: '1767c440b9e9c6c4e9e4499c66a700aef97073cfdb3619224805e124588b0858',
  validationContract: '7916451e371485ecc2027001c90bb24a809963a9409e8e948e826a996f7ce600',
  artifactSpecification: 'caef78434c96ed7cc4e4bfefac451c04f1a366f3d21bf11271ca24c0ebb30a18',
  bundle: 'b634e138b040674416ea24fd1fdd111db99f34210f4da3f8ac021ccb1f7c360c',
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
  it('carrega o bundle QA 1.0.4 imutável e autocontido', () => {
    const assets = loadQAPromptAssets();

    expect(assets.manifest).toMatchObject({
      id: 'assets:qa',
      version: '1.0.4',
      schemaVersion: '1.0.0',
      agent: 'QA',
    });
    expect(assets.template.version).toBe('1.0.4');
    expect(assets.ruleSets.map(({ id, version }) => ({ id, version }))).toEqual([
      { id: 'rules:global-baseline', version: '1.0.0' },
      { id: 'rules:security-baseline', version: '1.0.0' },
      { id: 'rules:qa', version: '1.0.4' },
    ]);
    expect(assets.outputContract.version).toBe('1.0.4');
    expect(assets.validationContract.version).toBe('1.0.4');
    expect(assets.artifactSpecification.version).toBe('1.0.4');
    expect(assets.hashes.bundleHash).toBe(QA_BUNDLE_1_0_4_HASH);
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
    expect(rawManifest.version).toBe('1.0.4');
    expect(rawGlobalRules).toEqual(historicalGlobalRules);
    expect(rawSecurityRules).toEqual(historicalSecurityRules);
    expect(rawOutputContract.schema).toEqual(historicalOutputContract.schema);
    expect(calculateCanonicalJsonHash(rawOutputContract.schema as unknown as JsonValue)).toBe(
      QA_SCHEMA_HASH,
    );
  });

  it('preserva integralmente o release histórico QA 1.0.1', () => {
    const componentHashes = {
      manifest: calculateCanonicalJsonHash(historical101Manifest as unknown as JsonValue),
      template: calculateCanonicalJsonHash(historical101Template as unknown as JsonValue),
      globalRules: calculateCanonicalJsonHash(historical101GlobalRules as unknown as JsonValue),
      securityRules: calculateCanonicalJsonHash(historical101SecurityRules as unknown as JsonValue),
      qaRules: calculateCanonicalJsonHash(historical101QARules as unknown as JsonValue),
      outputContract: calculateCanonicalJsonHash(
        historical101OutputContract as unknown as JsonValue,
      ),
      artifactSpecification: calculateCanonicalJsonHash(
        historical101ArtifactSpecification as unknown as JsonValue,
      ),
    };
    const validationContract = {
      id: historical101OutputContract.id,
      version: historical101OutputContract.version,
      expectedOutputContractHash: componentHashes.outputContract,
      format: 'JSON_SCHEMA',
      dialect: 'DRAFT_2020_12',
      schema: historical101OutputContract.schema,
    } as const;
    const validationContractHash = calculateCanonicalJsonHash(
      validationContract as unknown as JsonValue,
    );
    const bundleHash = calculateCanonicalJsonHash({
      manifest: {
        id: historical101Manifest.id,
        version: historical101Manifest.version,
        hash: componentHashes.manifest,
      },
      assets: [
        {
          kind: 'TEMPLATE',
          id: historical101Template.id,
          version: historical101Template.version,
          hash: componentHashes.template,
        },
        {
          kind: 'RULE_SET',
          id: historical101GlobalRules.id,
          version: historical101GlobalRules.version,
          hash: componentHashes.globalRules,
        },
        {
          kind: 'RULE_SET',
          id: historical101SecurityRules.id,
          version: historical101SecurityRules.version,
          hash: componentHashes.securityRules,
        },
        {
          kind: 'RULE_SET',
          id: historical101QARules.id,
          version: historical101QARules.version,
          hash: componentHashes.qaRules,
        },
        {
          kind: 'OUTPUT_CONTRACT',
          id: historical101OutputContract.id,
          version: historical101OutputContract.version,
          hash: componentHashes.outputContract,
        },
        {
          kind: 'VALIDATION_CONTRACT',
          id: validationContract.id,
          version: validationContract.version,
          hash: validationContractHash,
        },
        {
          kind: 'ARTIFACT_SPECIFICATION',
          id: historical101ArtifactSpecification.id,
          version: historical101ArtifactSpecification.version,
          hash: componentHashes.artifactSpecification,
        },
      ],
    });

    expect(historical101Manifest.version).toBe('1.0.1');
    expect({
      ...componentHashes,
      validationContract: validationContractHash,
      bundle: bundleHash,
    }).toEqual(HISTORICAL_QA_1_0_1_HASHES);
    expect(rawGlobalRules).toEqual(historical101GlobalRules);
    expect(rawSecurityRules).toEqual(historical101SecurityRules);
    expect(rawOutputContract.schema).toEqual(historical101OutputContract.schema);
  });

  it('preserva integralmente o release histórico QA 1.0.2 observado em produção', () => {
    const componentHashes = {
      manifest: calculateCanonicalJsonHash(historical102Manifest as unknown as JsonValue),
      template: calculateCanonicalJsonHash(historical102Template as unknown as JsonValue),
      globalRules: calculateCanonicalJsonHash(historical102GlobalRules as unknown as JsonValue),
      securityRules: calculateCanonicalJsonHash(historical102SecurityRules as unknown as JsonValue),
      qaRules: calculateCanonicalJsonHash(historical102QARules as unknown as JsonValue),
      outputContract: calculateCanonicalJsonHash(
        historical102OutputContract as unknown as JsonValue,
      ),
      artifactSpecification: calculateCanonicalJsonHash(
        historical102ArtifactSpecification as unknown as JsonValue,
      ),
    };
    const validationContract = {
      id: historical102OutputContract.id,
      version: historical102OutputContract.version,
      expectedOutputContractHash: componentHashes.outputContract,
      format: 'JSON_SCHEMA',
      dialect: 'DRAFT_2020_12',
      schema: historical102OutputContract.schema,
    } as const;
    const validationContractHash = calculateCanonicalJsonHash(
      validationContract as unknown as JsonValue,
    );
    const bundleHash = calculateCanonicalJsonHash({
      manifest: {
        id: historical102Manifest.id,
        version: historical102Manifest.version,
        hash: componentHashes.manifest,
      },
      assets: [
        {
          kind: 'TEMPLATE',
          id: historical102Template.id,
          version: historical102Template.version,
          hash: componentHashes.template,
        },
        {
          kind: 'RULE_SET',
          id: historical102GlobalRules.id,
          version: historical102GlobalRules.version,
          hash: componentHashes.globalRules,
        },
        {
          kind: 'RULE_SET',
          id: historical102SecurityRules.id,
          version: historical102SecurityRules.version,
          hash: componentHashes.securityRules,
        },
        {
          kind: 'RULE_SET',
          id: historical102QARules.id,
          version: historical102QARules.version,
          hash: componentHashes.qaRules,
        },
        {
          kind: 'OUTPUT_CONTRACT',
          id: historical102OutputContract.id,
          version: historical102OutputContract.version,
          hash: componentHashes.outputContract,
        },
        {
          kind: 'VALIDATION_CONTRACT',
          id: validationContract.id,
          version: validationContract.version,
          hash: validationContractHash,
        },
        {
          kind: 'ARTIFACT_SPECIFICATION',
          id: historical102ArtifactSpecification.id,
          version: historical102ArtifactSpecification.version,
          hash: componentHashes.artifactSpecification,
        },
      ],
    });

    expect(historical102Manifest.version).toBe('1.0.2');
    expect({
      ...componentHashes,
      validationContract: validationContractHash,
      bundle: bundleHash,
    }).toEqual(HISTORICAL_QA_1_0_2_HASHES);
    expect(rawGlobalRules).toEqual(historical102GlobalRules);
    expect(rawSecurityRules).toEqual(historical102SecurityRules);
    expect(rawOutputContract.schema).toEqual(historical102OutputContract.schema);
  });

  it('preserva integralmente o release histórico QA 1.0.3', () => {
    const componentHashes = {
      manifest: calculateCanonicalJsonHash(historical103Manifest as unknown as JsonValue),
      template: calculateCanonicalJsonHash(historical103Template as unknown as JsonValue),
      globalRules: calculateCanonicalJsonHash(historical103GlobalRules as unknown as JsonValue),
      securityRules: calculateCanonicalJsonHash(historical103SecurityRules as unknown as JsonValue),
      qaRules: calculateCanonicalJsonHash(historical103QARules as unknown as JsonValue),
      outputContract: calculateCanonicalJsonHash(
        historical103OutputContract as unknown as JsonValue,
      ),
      artifactSpecification: calculateCanonicalJsonHash(
        historical103ArtifactSpecification as unknown as JsonValue,
      ),
    };
    const validationContract = {
      id: historical103OutputContract.id,
      version: historical103OutputContract.version,
      expectedOutputContractHash: componentHashes.outputContract,
      format: 'JSON_SCHEMA',
      dialect: 'DRAFT_2020_12',
      schema: historical103OutputContract.schema,
    } as const;
    const validationContractHash = calculateCanonicalJsonHash(
      validationContract as unknown as JsonValue,
    );
    const bundleHash = calculateCanonicalJsonHash({
      manifest: {
        id: historical103Manifest.id,
        version: historical103Manifest.version,
        hash: componentHashes.manifest,
      },
      assets: [
        {
          kind: 'TEMPLATE',
          id: historical103Template.id,
          version: historical103Template.version,
          hash: componentHashes.template,
        },
        {
          kind: 'RULE_SET',
          id: historical103GlobalRules.id,
          version: historical103GlobalRules.version,
          hash: componentHashes.globalRules,
        },
        {
          kind: 'RULE_SET',
          id: historical103SecurityRules.id,
          version: historical103SecurityRules.version,
          hash: componentHashes.securityRules,
        },
        {
          kind: 'RULE_SET',
          id: historical103QARules.id,
          version: historical103QARules.version,
          hash: componentHashes.qaRules,
        },
        {
          kind: 'OUTPUT_CONTRACT',
          id: historical103OutputContract.id,
          version: historical103OutputContract.version,
          hash: componentHashes.outputContract,
        },
        {
          kind: 'VALIDATION_CONTRACT',
          id: validationContract.id,
          version: validationContract.version,
          hash: validationContractHash,
        },
        {
          kind: 'ARTIFACT_SPECIFICATION',
          id: historical103ArtifactSpecification.id,
          version: historical103ArtifactSpecification.version,
          hash: componentHashes.artifactSpecification,
        },
      ],
    });

    expect(historical103Manifest.version).toBe('1.0.3');
    expect({
      ...componentHashes,
      validationContract: validationContractHash,
      bundle: bundleHash,
    }).toEqual(HISTORICAL_QA_1_0_3_HASHES);
    expect(rawGlobalRules).toEqual(historical103GlobalRules);
    expect(rawSecurityRules).toEqual(historical103SecurityRules);
    expect(rawOutputContract.schema).toEqual(historical103OutputContract.schema);
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
    expect(first.hashes.bundleHash).toBe(QA_BUNDLE_1_0_4_HASH);
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
      'IDs funcionais válidos MAY coexistir',
    );
    expect(qaRuleContent('qa:technical-coverage')).toContain('IDs técnicos válidos MAY coexistir');
    expect(qaRuleContent('qa:scenario-categories')).toContain(
      'ao menos uma fonte da própria linha',
    );
  });

  it('fixa o preflight relacional par-a-par nas regras, no contrato e na instrução final', () => {
    const sources = [
      qaRuleContent('qa:pairwise-relational-audit'),
      rawOutputContract.instructions.join('\n'),
      finalInstructionContent(),
    ];
    const relationalMarkers = [
      'auditoria relacional par-a-par',
      'functionalCoverage',
      'technicalCoverage',
      'functionalReferences',
      'technicalReferences',
      'matrix',
      'igualdade exata',
      'summary',
      'contagens agregadas',
      'MUST NOT',
    ];

    for (const source of sources) {
      for (const marker of relationalMarkers) expect(source).toContain(marker);
      expect(source).toContain('CADA scenarioId');
      expect(source).toContain('Se qualquer');
    }

    const rule = qaRuleContent('qa:pairwise-relational-audit');
    expect(rule).toContain('sourceId da entrada em functionalReferences');
    expect(rule).toContain('sourceId da entrada em technicalReferences');
    expect(rule).toContain('functionalSourceIds da linha e functionalReferences do cenário');
    expect(rule).toContain('technicalSourceIds da linha e technicalReferences do cenário');
  });

  it('exige auditoria por AC e BR nas três superfícies antes de derivar o summary', () => {
    const sources = [
      [qaRuleContent('qa:functional-coverage'), qaRuleContent('qa:coverage-summary')].join('\n'),
      rawOutputContract.instructions.join('\n'),
      finalInstructionContent(),
    ];
    const markers = [
      'productOwnerSpecification.acceptanceCriteria[]',
      'productOwnerSpecification.businessRules[]',
      'functionalReferences',
      'functionalCoverage',
      'exatamente uma entrada',
      'scenarioIds não vazio',
      'functionalSourceIds',
      'acceptanceCriteria.total',
      'businessRules.total',
      'acceptanceCriteria.covered',
      'businessRules.covered',
    ];

    for (const source of sources) {
      for (const marker of markers) expect(source).toContain(marker);
      expect(source).toContain('MUST NOT omitir');
      expect(source.toLowerCase()).toContain('recalcule');
    }
  });

  it('exige auditoria por DEC e DOD nas três superfícies antes de derivar o summary', () => {
    const sources = [
      [qaRuleContent('qa:technical-coverage'), qaRuleContent('qa:coverage-summary')].join('\n'),
      rawOutputContract.instructions.join('\n'),
      finalInstructionContent(),
    ];
    const markers = [
      'technicalSpecification.decisions[]',
      'technicalSpecification.definitionOfDone[]',
      'technicalReferences',
      'technicalCoverage',
      'exatamente uma entrada',
      'scenarioIds não vazio',
      'technicalSourceIds',
      'technicalDecisions.total',
      'definitionOfDone.total',
      'technicalDecisions.covered',
      'definitionOfDone.covered',
      'por identidade',
    ];

    for (const source of sources) {
      for (const marker of markers) expect(source).toContain(marker);
      expect(source).toContain('CADA');
      expect(source).toContain('MUST NOT');
      expect(source).toContain('IF');
      expect(source).toContain('THEN');
      expect(source).toContain('contagem');
    }
    expect(finalInstructionContent()).toContain(
      'Retorne somente um objeto JSON aderente ao contrato',
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
    const outputContract = structuredClone(rawOutputContract);
    outputContract.instructions[0] = 'contrato adulterado';

    expect(qaPromptAssetManifestSchema.safeParse(manifest).success).toBe(false);
    expect(() => parseQAPromptAssets({ ...createSources(), qaRules })).toThrow(QAPromptAssetsError);
    expect(() => parseQAPromptAssets({ ...createSources(), outputContract })).toThrow(
      QAPromptAssetsError,
    );
    expect(() =>
      validateQAPromptAssets({
        ...assets,
        hashes: { ...assets.hashes, bundleHash: '0'.repeat(64) },
      }),
    ).toThrow(QAPromptAssetsError);
  });
});
