import { calculateCanonicalJsonHash } from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import historicalCodeGeneratorRules from '../../prompts/code-generator/1.0.0/code-generator-rules.json' with { type: 'json' };
import historicalGlobalRules from '../../prompts/code-generator/1.0.0/global-rules.json' with { type: 'json' };
import historicalManifest from '../../prompts/code-generator/1.0.0/manifest.json' with { type: 'json' };
import historicalOutputContract from '../../prompts/code-generator/1.0.0/output-contract.json' with { type: 'json' };
import historicalSecurityRules from '../../prompts/code-generator/1.0.0/security-rules.json' with { type: 'json' };
import historicalTemplate from '../../prompts/code-generator/1.0.0/template.json' with { type: 'json' };
import historical101CodeGeneratorRules from '../../prompts/code-generator/1.0.1/code-generator-rules.json' with { type: 'json' };
import historical101GlobalRules from '../../prompts/code-generator/1.0.1/global-rules.json' with { type: 'json' };
import historical101Manifest from '../../prompts/code-generator/1.0.1/manifest.json' with { type: 'json' };
import historical101OutputContract from '../../prompts/code-generator/1.0.1/output-contract.json' with { type: 'json' };
import historical101SecurityRules from '../../prompts/code-generator/1.0.1/security-rules.json' with { type: 'json' };
import historical101Template from '../../prompts/code-generator/1.0.1/template.json' with { type: 'json' };
import historical102CodeGeneratorRules from '../../prompts/code-generator/1.0.2/code-generator-rules.json' with { type: 'json' };
import historical102GlobalRules from '../../prompts/code-generator/1.0.2/global-rules.json' with { type: 'json' };
import historical102Manifest from '../../prompts/code-generator/1.0.2/manifest.json' with { type: 'json' };
import historical102OutputContract from '../../prompts/code-generator/1.0.2/output-contract.json' with { type: 'json' };
import historical102SecurityRules from '../../prompts/code-generator/1.0.2/security-rules.json' with { type: 'json' };
import historical102Template from '../../prompts/code-generator/1.0.2/template.json' with { type: 'json' };
import historical103CodeGeneratorRules from '../../prompts/code-generator/1.0.3/code-generator-rules.json' with { type: 'json' };
import historical103GlobalRules from '../../prompts/code-generator/1.0.3/global-rules.json' with { type: 'json' };
import historical103Manifest from '../../prompts/code-generator/1.0.3/manifest.json' with { type: 'json' };
import historical103OutputContract from '../../prompts/code-generator/1.0.3/output-contract.json' with { type: 'json' };
import historical103SecurityRules from '../../prompts/code-generator/1.0.3/security-rules.json' with { type: 'json' };
import historical103Template from '../../prompts/code-generator/1.0.3/template.json' with { type: 'json' };
import rawCodeGeneratorRules from '../../prompts/code-generator/1.0.4/code-generator-rules.json' with { type: 'json' };
import rawGlobalRules from '../../prompts/code-generator/1.0.4/global-rules.json' with { type: 'json' };
import rawManifest from '../../prompts/code-generator/1.0.4/manifest.json' with { type: 'json' };
import rawOutputContract from '../../prompts/code-generator/1.0.4/output-contract.json' with { type: 'json' };
import rawSecurityRules from '../../prompts/code-generator/1.0.4/security-rules.json' with { type: 'json' };
import rawTemplate from '../../prompts/code-generator/1.0.4/template.json' with { type: 'json' };
import { calculateCodeGeneratorAssetBundleHash } from './asset-hashing';
import {
  CodeGeneratorPromptAssetsError,
  loadCodeGeneratorPromptAssets,
  parseCodeGeneratorPromptAssets,
  validateCodeGeneratorPromptAssets,
  type CodeGeneratorPromptAssetSources,
} from './prompt-assets';

const RELEASE_HASH = 'c4155a8e745c9c3ac5e4d8803f04347b422c80d3af960fb76615b488c968c512';
const HISTORICAL_1_0_3_BUNDLE_HASH =
  '1fb3373314ba1eb041fa582138deda3fc9142b509592d4fa46f1bda8afdd16bf';
const HISTORICAL_1_0_2_BUNDLE_HASH =
  '5d58517c8c81cd6450527d46a8685cbbaa70f083eeaf1f596c2381d85c31aae2';
const HISTORICAL_1_0_0_HASHES = {
  manifest: 'e20a8210af1b589c80ca71da51b7510e78bc907440215eeee3571c57df9f2ef2',
  template: 'a6467779782b17ba238941da924e025e728d6e4add0034a0b9566afc41b9976d',
  globalRules: '9b2166e321e01fb0b90758af54b521744c03067b3d664c26ab8362010a424670',
  securityRules: 'cb317934f4ef9ff1a384ed6e9c94b03d8a8de617f67167e27fb4877613d7978a',
  codeGeneratorRules: '720c87d4c62380a1ddb30a6bf151ee29a76cbb7d59786eeeafe1227558e3649e',
  outputContract: '39969854b645cc298bf0603cda37ca1d299a856699797926e3eb220c39c9a368',
} as const;
const HISTORICAL_1_0_1_HASHES = {
  manifest: '6ac8cc78b93209bf609950fb2d5b72cb994dbb445d4e8fbeb456e5a80ef4564f',
  template: '9e78fe7baccf9af9d9810614b8aee7aebe9a5b27eccce24ce89d1f81922864dd',
  globalRules: '9b2166e321e01fb0b90758af54b521744c03067b3d664c26ab8362010a424670',
  securityRules: '08dd4d2a416d3353d2390b971f703f77c04c3191b17d690aebba21647fd8411d',
  codeGeneratorRules: '4c9e172d7971929f9b342571b4779452cce24650e10c9f9606cb74de3d35f51f',
  outputContract: '39969854b645cc298bf0603cda37ca1d299a856699797926e3eb220c39c9a368',
  validationContract: '4de9a80162108b4c89a6f4ea7997698b26790442a6dafcc0e8647c29d5f83392',
  bundle: '29231d2db54ab9aeb2c89a29cb60d5098fe625a03aeef6ec6180b54c8bdb84ca',
} as const;

function sources(): CodeGeneratorPromptAssetSources {
  return structuredClone({
    manifest: rawManifest,
    template: rawTemplate,
    globalRules: rawGlobalRules,
    securityRules: rawSecurityRules,
    codeGeneratorRules: rawCodeGeneratorRules,
    outputContract: rawOutputContract,
  });
}

function calculateHistorical101Hashes() {
  const componentHashes = {
    manifest: calculateCanonicalJsonHash(historical101Manifest as unknown as JsonValue),
    template: calculateCanonicalJsonHash(historical101Template as unknown as JsonValue),
    globalRules: calculateCanonicalJsonHash(historical101GlobalRules as unknown as JsonValue),
    securityRules: calculateCanonicalJsonHash(historical101SecurityRules as unknown as JsonValue),
    codeGeneratorRules: calculateCanonicalJsonHash(
      historical101CodeGeneratorRules as unknown as JsonValue,
    ),
    outputContract: calculateCanonicalJsonHash(historical101OutputContract as unknown as JsonValue),
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
  const bundleHash = calculateCodeGeneratorAssetBundleHash({
    manifest: {
      id: historical101Manifest.id,
      version: historical101Manifest.version,
      hash: componentHashes.manifest,
    },
    template: {
      id: historical101Template.id,
      version: historical101Template.version,
      hash: componentHashes.template,
    },
    ruleSets: [
      {
        id: historical101GlobalRules.id,
        version: historical101GlobalRules.version,
        hash: componentHashes.globalRules,
      },
      {
        id: historical101SecurityRules.id,
        version: historical101SecurityRules.version,
        hash: componentHashes.securityRules,
      },
      {
        id: historical101CodeGeneratorRules.id,
        version: historical101CodeGeneratorRules.version,
        hash: componentHashes.codeGeneratorRules,
      },
    ],
    outputContract: {
      id: historical101OutputContract.id,
      version: historical101OutputContract.version,
      hash: componentHashes.outputContract,
    },
    validationContract: {
      id: validationContract.id,
      version: validationContract.version,
      hash: validationContractHash,
    },
  });

  return { ...componentHashes, validationContract: validationContractHash, bundle: bundleHash };
}

function calculateHistorical102BundleHash(): string {
  const outputContractHash = calculateCanonicalJsonHash(
    historical102OutputContract as unknown as JsonValue,
  );
  const validationContract = {
    id: historical102OutputContract.id,
    version: historical102OutputContract.version,
    expectedOutputContractHash: outputContractHash,
    format: 'JSON_SCHEMA',
    dialect: 'DRAFT_2020_12',
    schema: historical102OutputContract.schema,
  } as const;
  return calculateCodeGeneratorAssetBundleHash({
    manifest: {
      id: historical102Manifest.id,
      version: historical102Manifest.version,
      hash: calculateCanonicalJsonHash(historical102Manifest as unknown as JsonValue),
    },
    template: {
      id: historical102Template.id,
      version: historical102Template.version,
      hash: calculateCanonicalJsonHash(historical102Template as unknown as JsonValue),
    },
    ruleSets: [
      historical102GlobalRules,
      historical102SecurityRules,
      historical102CodeGeneratorRules,
    ].map((ruleSet) => ({
      id: ruleSet.id,
      version: ruleSet.version,
      hash: calculateCanonicalJsonHash(ruleSet as unknown as JsonValue),
    })),
    outputContract: {
      id: historical102OutputContract.id,
      version: historical102OutputContract.version,
      hash: outputContractHash,
    },
    validationContract: {
      id: validationContract.id,
      version: validationContract.version,
      hash: calculateCanonicalJsonHash(validationContract as unknown as JsonValue),
    },
  });
}

function calculateHistorical103BundleHash(): string {
  const outputContractHash = calculateCanonicalJsonHash(
    historical103OutputContract as unknown as JsonValue,
  );
  const validationContract = {
    id: historical103OutputContract.id,
    version: historical103OutputContract.version,
    expectedOutputContractHash: outputContractHash,
    format: 'JSON_SCHEMA',
    dialect: 'DRAFT_2020_12',
    schema: historical103OutputContract.schema,
  } as const;
  return calculateCodeGeneratorAssetBundleHash({
    manifest: {
      id: historical103Manifest.id,
      version: historical103Manifest.version,
      hash: calculateCanonicalJsonHash(historical103Manifest as unknown as JsonValue),
    },
    template: {
      id: historical103Template.id,
      version: historical103Template.version,
      hash: calculateCanonicalJsonHash(historical103Template as unknown as JsonValue),
    },
    ruleSets: [
      historical103GlobalRules,
      historical103SecurityRules,
      historical103CodeGeneratorRules,
    ].map((ruleSet) => ({
      id: ruleSet.id,
      version: ruleSet.version,
      hash: calculateCanonicalJsonHash(ruleSet as unknown as JsonValue),
    })),
    outputContract: {
      id: historical103OutputContract.id,
      version: historical103OutputContract.version,
      hash: outputContractHash,
    },
    validationContract: {
      id: validationContract.id,
      version: validationContract.version,
      hash: calculateCanonicalJsonHash(validationContract as unknown as JsonValue),
    },
  });
}

function finalInstruction(): string {
  const section = rawTemplate.sections.find(({ kind }) => kind === 'FINAL_INSTRUCTION');
  const fragment = section?.blocks.flatMap(({ fragments }) => fragments)[0];
  if (fragment === undefined || !('value' in fragment) || typeof fragment.value !== 'string') {
    throw new Error('Expected Code Generator final instruction.');
  }
  return fragment.value;
}

interface MutablePromptManifest {
  assets: {
    template: { id: string; filename: string };
    ruleSets: Array<{ id: string; filename: string }>;
  };
  contexts: { knowledge: string; technicalSpecification: string };
}

function mutableManifest(): MutablePromptManifest {
  return structuredClone(rawManifest) as unknown as MutablePromptManifest;
}

function strictObjectSchemaViolations(value: unknown, path = '$'): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      strictObjectSchemaViolations(entry, `${path}[${index}]`),
    );
  }
  if (value === null || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const violations: string[] = [];
  if (record['type'] === 'object') {
    const properties = record['properties'];
    const names =
      properties !== null && typeof properties === 'object' && !Array.isArray(properties)
        ? Object.keys(properties)
        : [];
    const required = Array.isArray(record['required']) ? record['required'] : [];
    if (record['additionalProperties'] !== false) violations.push(`${path}.additionalProperties`);
    if (required.length !== names.length || names.some((name) => !required.includes(name))) {
      violations.push(`${path}.required`);
    }
  }
  return [
    ...violations,
    ...Object.entries(record).flatMap(([key, nested]) =>
      strictObjectSchemaViolations(nested, `${path}.${key}`),
    ),
  ];
}

describe('Code Generator prompt assets', () => {
  it('loads one immutable and deterministic 1.0.4 bundle', () => {
    const bundle = loadCodeGeneratorPromptAssets();

    expect(bundle.manifest).toMatchObject({
      id: 'assets:code-generator',
      version: '1.0.4',
      schemaVersion: '1.0.0',
      agent: 'CODE_GENERATOR',
      contexts: {
        knowledge: 'context:code-generator-knowledge',
        technicalSpecification: 'context:code-generator-technical-specification',
      },
    });
    expect(bundle.template.version).toBe('1.0.4');
    expect(bundle.ruleSets.map(({ version }) => version)).toEqual(['1.0.0', '1.0.1', '1.0.4']);
    expect(bundle.outputContract.version).toBe('1.0.0');
    expect(bundle.hashes.bundleHash).toBe(RELEASE_HASH);
    expect(bundle.validationContract).toMatchObject({
      id: bundle.outputContract.id,
      version: bundle.outputContract.version,
      format: 'JSON_SCHEMA',
      expectedOutputContractHash: bundle.hashes.outputContractHash,
    });
    expect(loadCodeGeneratorPromptAssets()).toBe(bundle);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.ruleSets)).toBe(true);
    expect(Object.isFrozen(bundle.outputContract.schema)).toBe(true);
  });

  it('preserves every historical 1.0.0 asset while activating 1.0.4', () => {
    expect({
      manifest: calculateCanonicalJsonHash(historicalManifest as unknown as JsonValue),
      template: calculateCanonicalJsonHash(historicalTemplate as unknown as JsonValue),
      globalRules: calculateCanonicalJsonHash(historicalGlobalRules as unknown as JsonValue),
      securityRules: calculateCanonicalJsonHash(historicalSecurityRules as unknown as JsonValue),
      codeGeneratorRules: calculateCanonicalJsonHash(
        historicalCodeGeneratorRules as unknown as JsonValue,
      ),
      outputContract: calculateCanonicalJsonHash(historicalOutputContract as unknown as JsonValue),
    }).toEqual(HISTORICAL_1_0_0_HASHES);
    expect(rawGlobalRules).toEqual(historicalGlobalRules);
    expect(rawOutputContract).toEqual(historicalOutputContract);
    expect(rawOutputContract.schema).toEqual(historicalOutputContract.schema);
    expect(loadCodeGeneratorPromptAssets().manifest.version).toBe('1.0.4');
  });

  it('preserves every historical 1.0.1 asset and its deterministic bundle hash', () => {
    expect(calculateHistorical101Hashes()).toEqual(HISTORICAL_1_0_1_HASHES);
    expect(historical101Manifest.version).toBe('1.0.1');
    expect(rawGlobalRules).toEqual(historical101GlobalRules);
    expect(rawSecurityRules).toEqual(historical101SecurityRules);
    expect(rawOutputContract).toEqual(historical101OutputContract);
    expect(rawOutputContract.schema).toEqual(historical101OutputContract.schema);
    expect(rawManifest.version).toBe('1.0.4');
  });

  it('preserves the immutable 1.0.2 bundle while activating 1.0.4', () => {
    expect(calculateHistorical102BundleHash()).toBe(HISTORICAL_1_0_2_BUNDLE_HASH);
    expect(historical102Manifest.version).toBe('1.0.2');
    expect(rawGlobalRules).toEqual(historical102GlobalRules);
    expect(rawSecurityRules).toEqual(historical102SecurityRules);
    expect(rawOutputContract).toEqual(historical102OutputContract);
    expect(rawOutputContract.schema).toEqual(historical102OutputContract.schema);
    expect(rawManifest.version).toBe('1.0.4');
  });

  it('preserves the immutable 1.0.3 bundle while activating 1.0.4', () => {
    expect(calculateHistorical103BundleHash()).toBe(HISTORICAL_1_0_3_BUNDLE_HASH);
    expect(historical103Manifest.version).toBe('1.0.3');
    expect(rawGlobalRules).toEqual(historical103GlobalRules);
    expect(rawSecurityRules).toEqual(historical103SecurityRules);
    expect(rawOutputContract).toEqual(historical103OutputContract);
    expect(rawOutputContract.schema).toEqual(historical103OutputContract.schema);
    expect(rawManifest.version).toBe('1.0.4');
  });

  it('pins every asset hash and the exact release bundle hash', () => {
    const first = parseCodeGeneratorPromptAssets(sources());
    const second = parseCodeGeneratorPromptAssets(sources());

    expect(first.hashes).toEqual(second.hashes);
    expect(first.hashes.bundleHash).toBe(RELEASE_HASH);
    expect(first.hashes.manifestHash).toBe(
      calculateCanonicalJsonHash(rawManifest as unknown as JsonValue),
    );
    expect(Object.values(first.hashes).flat()).not.toContain(expect.stringContaining('sha256:'));
  });

  it('keeps every JSON Schema object closed and required for strict Structured Outputs', () => {
    const schema = loadCodeGeneratorPromptAssets().outputContract.schema;
    expect(strictObjectSchemaViolations(schema)).toEqual([]);
  });

  it('keeps the model output restricted to files and entrypoints without authoritative metadata', () => {
    const contract = loadCodeGeneratorPromptAssets().outputContract;
    const schema = contract.schema as Record<string, unknown>;
    const serializedSchema = JSON.stringify(schema);

    expect(Object.keys(schema['properties'] as object)).toEqual(['files', 'entrypoints']);
    expect(serializedSchema).not.toMatch(
      /bundleHash|generationHash|lineage|provenance|contentHash/,
    );
    expect(contract.instructions.join(' ')).toContain('ao menos um entrypoint');
  });

  it('states trust, safe paths, source references, CREATE coverage and byte ceilings normatively', () => {
    const rules = [...rawSecurityRules.rules, ...rawCodeGeneratorRules.rules]
      .map((rule) => rule.content)
      .join('\n');

    expect(rules).toContain('dados não confiáveis');
    expect(rules).toContain('MUST NOT gerar .env');
    expect(rules).toContain('Todo Module com changeType CREATE MUST');
    expect(rules).toContain('sourcePlanItemIds');
    expect(rules).toContain('65536 bytes UTF-8');
    expect(rules).toContain('ao menos um entrypoint');
    expect(rules).toContain('execution profile constraints em CONSTRAINTS');
    expect(rules).toContain('MUST NOT inferir capacidades além das declaradas');
    expect(JSON.stringify(rawTemplate)).toContain('CONSTRAINTS_SLOT');
  });

  it('keeps profile rules generic while making module/path preflight explicit in 1.0.4', () => {
    const historicalProfileRule = historical102CodeGeneratorRules.rules.find(
      ({ id }) => id === 'code-generator:host-profile',
    );
    const profileRule = rawCodeGeneratorRules.rules.find(
      ({ id }) => id === 'code-generator:host-profile',
    );

    expect(historicalProfileRule?.content).toContain('bundle MUST conter pelo menos um arquivo');
    expect(historicalProfileRule?.content).toContain(
      'termine EXATAMENTE em um dos testFileSuffixes',
    );
    expect(historicalProfileRule?.content).toContain('.test.js ou .test.ts');
    expect(historicalProfileRule?.content).toContain('incluindo .jsx e .tsx');
    expect(historicalProfileRule?.content).toContain(
      'IF nenhum files[].path satisfizer testFileSuffixes, THEN o bundle é inválido',
    );
    expect(profileRule?.content).toContain('MUST obey every supplied rule');
    expect(profileRule?.content).toContain('MUST validar o bundle final contra todas as regras');
    expect(finalInstruction()).toContain('contra cada regra e parâmetro');
    expect(finalInstruction()).toContain('Um bundle que viole qualquer regra fornecida é inválido');
    expect(`${profileRule?.content}\n${finalInstruction()}`).not.toMatch(
      /\.test\.js|\.test\.ts|\.jsx|\.tsx/u,
    );
    expect(JSON.stringify(rawCodeGeneratorRules)).toContain('code-generator:root-shared-files');
    expect(JSON.stringify(rawCodeGeneratorRules)).toContain(
      'code-generator:business-validation-preflight',
    );
    expect(finalInstruction()).toContain('cada sourceModuleId deve ser compatível');
    expect(finalInstruction()).toContain('sourceModuleIds vazio e sourcePlanItemIds válidos');
  });

  it('rejects asset drift, wiring changes and forged injected hashes', () => {
    const changedRules = structuredClone(rawCodeGeneratorRules);
    changedRules.rules[0]!.content = 'drift';
    expect(() =>
      parseCodeGeneratorPromptAssets({ ...sources(), codeGeneratorRules: changedRules }),
    ).toThrow(CodeGeneratorPromptAssetsError);

    const changedTemplate = structuredClone(rawTemplate);
    changedTemplate.sections[0]!.blocks[0]!.fragments[0] = {
      id: 'global-rules:slot',
      type: 'RULE_SET_SLOT',
      ruleSetId: 'rules:code-generator-security',
    };
    changedTemplate.sections[1]!.blocks[0]!.fragments[0] = {
      id: 'security-rules:slot',
      type: 'RULE_SET_SLOT',
      ruleSetId: 'rules:code-generator-global',
    };
    expect(() =>
      parseCodeGeneratorPromptAssets({ ...sources(), template: changedTemplate }),
    ).toThrow(CodeGeneratorPromptAssetsError);

    const loaded = structuredClone(loadCodeGeneratorPromptAssets()) as unknown as {
      hashes: { bundleHash: string };
    };
    loaded.hashes.bundleHash = '0'.repeat(64);
    expect(() => validateCodeGeneratorPromptAssets(loaded)).toThrow(CodeGeneratorPromptAssetsError);
  });

  it('rejects duplicate manifest identities, filenames and context bindings', () => {
    const duplicateId = mutableManifest();
    duplicateId.assets.ruleSets[0]!.id = duplicateId.assets.template.id;

    const duplicateFilename = mutableManifest();
    duplicateFilename.assets.ruleSets[0]!.filename = duplicateFilename.assets.template.filename;

    const duplicateContext = mutableManifest();
    duplicateContext.contexts.technicalSpecification = duplicateContext.contexts.knowledge;

    for (const manifest of [duplicateId, duplicateFilename, duplicateContext]) {
      expect(() => parseCodeGeneratorPromptAssets({ ...sources(), manifest })).toThrow(
        CodeGeneratorPromptAssetsError,
      );
    }
  });

  it('rejects a structurally valid TEXT output contract and malformed injected bundles', () => {
    const textContract = {
      id: rawOutputContract.id,
      version: rawOutputContract.version,
      format: 'TEXT',
      instructions: rawOutputContract.instructions,
    } as const;

    expect(() =>
      parseCodeGeneratorPromptAssets({ ...sources(), outputContract: textContract }),
    ).toThrow(CodeGeneratorPromptAssetsError);
    expect(() => validateCodeGeneratorPromptAssets({})).toThrow(CodeGeneratorPromptAssetsError);
  });
});
