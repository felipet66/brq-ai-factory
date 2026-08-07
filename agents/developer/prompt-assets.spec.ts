import { artifactSpecificationSchema } from '@brq/artifact-generator';
import { calculateCanonicalJsonHash } from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import historicalArtifactSpecification from '../../prompts/developer/1.0.0/artifact-specification.json' with { type: 'json' };
import historicalDeveloperRules from '../../prompts/developer/1.0.0/developer-rules.json' with { type: 'json' };
import historicalGlobalRules from '../../prompts/developer/1.0.0/global-rules.json' with { type: 'json' };
import historicalManifest from '../../prompts/developer/1.0.0/manifest.json' with { type: 'json' };
import historicalOutputContract from '../../prompts/developer/1.0.0/output-contract.json' with { type: 'json' };
import historicalSecurityRules from '../../prompts/developer/1.0.0/security-rules.json' with { type: 'json' };
import historicalTemplate from '../../prompts/developer/1.0.0/template.json' with { type: 'json' };
import release101ArtifactSpecification from '../../prompts/developer/1.0.1/artifact-specification.json' with { type: 'json' };
import release101DeveloperRules from '../../prompts/developer/1.0.1/developer-rules.json' with { type: 'json' };
import release101GlobalRules from '../../prompts/developer/1.0.1/global-rules.json' with { type: 'json' };
import release101Manifest from '../../prompts/developer/1.0.1/manifest.json' with { type: 'json' };
import release101OutputContract from '../../prompts/developer/1.0.1/output-contract.json' with { type: 'json' };
import release101SecurityRules from '../../prompts/developer/1.0.1/security-rules.json' with { type: 'json' };
import release101Template from '../../prompts/developer/1.0.1/template.json' with { type: 'json' };
import rawArtifactSpecification from '../../prompts/developer/1.0.2/artifact-specification.json' with { type: 'json' };
import rawDeveloperRules from '../../prompts/developer/1.0.2/developer-rules.json' with { type: 'json' };
import rawGlobalRules from '../../prompts/developer/1.0.2/global-rules.json' with { type: 'json' };
import rawManifest from '../../prompts/developer/1.0.2/manifest.json' with { type: 'json' };
import rawOutputContract from '../../prompts/developer/1.0.2/output-contract.json' with { type: 'json' };
import rawSecurityRules from '../../prompts/developer/1.0.2/security-rules.json' with { type: 'json' };
import rawTemplate from '../../prompts/developer/1.0.2/template.json' with { type: 'json' };

import {
  DeveloperPromptAssetsError,
  developerPromptAssetManifestSchema,
  loadDeveloperPromptAssets,
  parseDeveloperPromptAssets,
  type DeveloperPromptAssetSources,
  validateDeveloperPromptAssets,
} from './prompt-assets';

const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const DEVELOPER_BUNDLE_1_0_2_HASH =
  '1ba2ab3886133cd4f7cac0bf5e3e01dbd3517083e9aa22f30ed57a2963195532';
const HISTORICAL_DEVELOPER_1_0_0_HASHES = {
  manifest: '2f3721696e349efa96a3504733fc6721b5c3a4ba9089826a25a7a3ef6a8d0661',
  template: '07234b11593e36dc4045006d34402918574edccc7cacde1de03f8393a1901940',
  globalRules: 'eaa5d555158cdba2cb5229d81a7917d5e0d8d0591b309c9229195fbdbf8f2715',
  securityRules: '0177cbe77feaa7ef6a46b414c0ea6fc025fabc3aa84e9ece98c7cf126478fbbc',
  developerRules: '3c256e8b368b390f15918e68db274a66063efe06e6c83ee2c2d1e0b8d5ee2d6b',
  outputContract: '6012814e6da03e7c8f4fd8569eebb56d29fca5ffa7063d463cc139765458477a',
  artifactSpecification: '3b921a27e9c88740f16764e8f484a5807fecb5e64e503d9d4c07e9940cf46188',
} as const;
const HISTORICAL_DEVELOPER_1_0_1_HASHES = {
  manifest: '44257a1161eb39d77b09825fb782abce45f1897419d3ad49831704a31a1574c0',
  template: 'b27823a201e5f9c5114054de3dadfb1accea32f8fc86f9ba3ed78ff293b31cbc',
  globalRules: 'eaa5d555158cdba2cb5229d81a7917d5e0d8d0591b309c9229195fbdbf8f2715',
  securityRules: '0177cbe77feaa7ef6a46b414c0ea6fc025fabc3aa84e9ece98c7cf126478fbbc',
  developerRules: '96bd9cb92c617b3248001639ffda7b6605656c4b0c0d2eb6a92f56ea77049ac3',
  outputContract: '90eb63403cb096361c1589848e7fd9c72454e3edcaf0c74dd86ae0da56884f8a',
  artifactSpecification: '762c393cd1379cb297c56f446ad89d4784519e6f1e01c14ea34ada11be4e56bf',
} as const;
const CANONICAL_ARTIFACT_IDENTITIES = [
  {
    id: 'artifact:developer-architecture',
    name: 'Developer Architecture',
    filename: 'architecture.md',
    type: 'DEVELOPER_ARCHITECTURE',
    format: 'TEXT',
    mediaType: 'text/markdown',
  },
  {
    id: 'artifact:developer-implementation-plan',
    name: 'Developer Implementation Plan',
    filename: 'implementation-plan.md',
    type: 'DEVELOPER_IMPLEMENTATION_PLAN',
    format: 'TEXT',
    mediaType: 'text/markdown',
  },
  {
    id: 'artifact:developer-technical-decisions',
    name: 'Developer Technical Decisions',
    filename: 'technical-decisions.json',
    type: 'DEVELOPER_TECHNICAL_DECISIONS',
    format: 'JSON',
    mediaType: 'application/json',
  },
] as const;
const TECHNICAL_SPECIFICATION_PROPERTIES = [
  'readiness',
  'title',
  'summary',
  'objective',
  'complexity',
  'estimatedStoryPoints',
  'architecture',
  'components',
  'modules',
  'flows',
  'contracts',
  'apis',
  'events',
  'dataModel',
  'internalDependencies',
  'externalDependencies',
  'risks',
  'implementationPhases',
  'implementationPlan',
  'technicalBacklog',
  'definitionOfDone',
  'decisions',
  'traceability',
  'assumptions',
  'openQuestions',
  'outOfScope',
] as const;

function createSources(): DeveloperPromptAssetSources {
  return structuredClone({
    manifest: rawManifest,
    template: rawTemplate,
    globalRules: rawGlobalRules,
    securityRules: rawSecurityRules,
    developerRules: rawDeveloperRules,
    outputContract: rawOutputContract,
    artifactSpecification: rawArtifactSpecification,
  });
}

function replaceSource(
  replacement: Partial<DeveloperPromptAssetSources>,
): DeveloperPromptAssetSources {
  return { ...createSources(), ...replacement };
}

function developerRuleContent(id: string): string {
  const rule = rawDeveloperRules.rules.find((candidate) => candidate.id === id);
  if (rule === undefined) throw new Error(`Expected Developer rule ${id}.`);
  return rule.content;
}

function strictObjectSchemaViolations(value: unknown, path = '$'): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      strictObjectSchemaViolations(entry, path + '[' + index + ']'),
    );
  }
  if (value === null || typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  const ownViolations: string[] = [];
  if (record['type'] === 'object') {
    const properties = record['properties'];
    const propertyNames =
      properties !== null && typeof properties === 'object' && !Array.isArray(properties)
        ? Object.keys(properties)
        : [];
    const required = Array.isArray(record['required']) ? record['required'] : [];

    if (record['additionalProperties'] !== false) {
      ownViolations.push(path + '.additionalProperties');
    }
    if (
      required.length !== propertyNames.length ||
      propertyNames.some((property) => !required.includes(property))
    ) {
      ownViolations.push(path + '.required');
    }
  }

  return [
    ...ownViolations,
    ...Object.entries(record).flatMap(([key, nested]) =>
      strictObjectSchemaViolations(nested, path + '.' + key),
    ),
  ];
}

describe('Developer prompt assets', () => {
  it('loads the immutable, self-contained and versioned Developer bundle', () => {
    const bundle = loadDeveloperPromptAssets();

    expect(bundle.manifest).toMatchObject({
      id: 'assets:developer',
      version: '1.0.2',
      schemaVersion: '1.0.0',
      agent: 'DEVELOPER',
      contexts: {
        knowledge: 'context:developer-knowledge',
        productOwnerSpecification: 'context:product-owner-specification',
      },
    });
    expect(bundle.template).toMatchObject({
      id: 'prompt:developer',
      version: '1.0.2',
      agent: 'DEVELOPER',
    });
    expect(
      bundle.ruleSets.map(({ id, version, scope, agent }) => ({ id, version, scope, agent })),
    ).toEqual([
      { id: 'rules:global-baseline', version: '1.0.0', scope: 'GLOBAL', agent: null },
      { id: 'rules:security-baseline', version: '1.0.0', scope: 'SECURITY', agent: null },
      { id: 'rules:developer', version: '1.0.2', scope: 'AGENT', agent: 'DEVELOPER' },
    ]);
    expect(bundle.outputContract).toMatchObject({
      id: 'contract:developer-technical-specification',
      version: '1.0.2',
      format: 'JSON_SCHEMA',
    });
    expect(bundle.validationContract).toMatchObject({
      id: bundle.outputContract.id,
      version: bundle.outputContract.version,
      format: 'JSON_SCHEMA',
      dialect: 'DRAFT_2020_12',
      expectedOutputContractHash: bundle.hashes.outputContractHash,
    });
    expect(bundle.artifactSpecification.templates).toHaveLength(3);
    expect(bundle.artifactSpecification.version).toBe('1.0.2');
    expect(loadDeveloperPromptAssets()).toBe(bundle);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.template.sections)).toBe(true);
    expect(Object.isFrozen(bundle.artifactSpecification.templates)).toBe(true);
  });

  it('preserves immutable Developer 1.0.0 and 1.0.1 assets while activating 1.0.2', () => {
    const historicalHashes = {
      manifest: calculateCanonicalJsonHash(historicalManifest as unknown as JsonValue),
      template: calculateCanonicalJsonHash(historicalTemplate as unknown as JsonValue),
      globalRules: calculateCanonicalJsonHash(historicalGlobalRules as unknown as JsonValue),
      securityRules: calculateCanonicalJsonHash(historicalSecurityRules as unknown as JsonValue),
      developerRules: calculateCanonicalJsonHash(historicalDeveloperRules as unknown as JsonValue),
      outputContract: calculateCanonicalJsonHash(historicalOutputContract as unknown as JsonValue),
      artifactSpecification: calculateCanonicalJsonHash(
        historicalArtifactSpecification as unknown as JsonValue,
      ),
    };
    const release101Hashes = {
      manifest: calculateCanonicalJsonHash(release101Manifest as unknown as JsonValue),
      template: calculateCanonicalJsonHash(release101Template as unknown as JsonValue),
      globalRules: calculateCanonicalJsonHash(release101GlobalRules as unknown as JsonValue),
      securityRules: calculateCanonicalJsonHash(release101SecurityRules as unknown as JsonValue),
      developerRules: calculateCanonicalJsonHash(release101DeveloperRules as unknown as JsonValue),
      outputContract: calculateCanonicalJsonHash(release101OutputContract as unknown as JsonValue),
      artifactSpecification: calculateCanonicalJsonHash(
        release101ArtifactSpecification as unknown as JsonValue,
      ),
    };

    expect(historicalManifest.version).toBe('1.0.0');
    expect(historicalHashes).toEqual(HISTORICAL_DEVELOPER_1_0_0_HASHES);
    expect(release101Manifest.version).toBe('1.0.1');
    expect(release101Hashes).toEqual(HISTORICAL_DEVELOPER_1_0_1_HASHES);
    expect(loadDeveloperPromptAssets().manifest.version).toBe('1.0.2');
  });

  it('produces deterministic canonical hashes and preserves asset order', () => {
    const first = parseDeveloperPromptAssets(createSources());
    const second = parseDeveloperPromptAssets(createSources());
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
    expect(first.hashes.bundleHash).toBe(DEVELOPER_BUNDLE_1_0_2_HASH);
    expect(hashes).toHaveLength(9);
    expect(hashes.every((hash) => SHA_256_HEX_PATTERN.test(hash))).toBe(true);
    expect(first.hashes.outputContractHash).toBe(
      calculateCanonicalJsonHash(first.outputContract as unknown as JsonValue),
    );
    expect(first.hashes.validationContractHash).toBe(
      calculateCanonicalJsonHash(first.validationContract as unknown as JsonValue),
    );
    expect(first.artifactSpecification.sourceContract.contractHash).toBe(
      first.hashes.validationContractHash,
    );
  });

  it('revalidates injected bundles and rejects self-reported hash tampering', () => {
    const valid = parseDeveloperPromptAssets(createSources());
    const tamperedHash = {
      ...valid,
      hashes: { ...valid.hashes, bundleHash: '0'.repeat(64) },
    };
    const tamperedValidationContract = {
      ...valid,
      validationContract: {
        ...valid.validationContract,
        expectedOutputContractHash: '0'.repeat(64),
      },
    };

    expect(validateDeveloperPromptAssets(valid)).toEqual(valid);
    expect(() => validateDeveloperPromptAssets(tamperedHash)).toThrowError(
      DeveloperPromptAssetsError,
    );
    expect(() => validateDeveloperPromptAssets(tamperedValidationContract)).toThrowError(
      DeveloperPromptAssetsError,
    );
  });

  it('keeps output and artifact contracts aligned with their canonical shapes', () => {
    const bundle = loadDeveloperPromptAssets();
    const schema = bundle.outputContract.schema as {
      readonly additionalProperties: boolean;
      readonly properties: Readonly<Record<string, unknown>>;
      readonly required: readonly string[];
    };

    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toEqual(TECHNICAL_SPECIFICATION_PROPERTIES);
    expect(schema.required).toEqual(TECHNICAL_SPECIFICATION_PROPERTIES);
    expect(rawOutputContract.schema.$defs.architecture.properties.principles.maxItems).toBe(20);
    expect(rawOutputContract.schema.$defs.architecture.properties.trustBoundaries.maxItems).toBe(
      30,
    );
    expect(bundle.outputContract.instructions.join(' ')).toContain(
      'preserve PARTIALLY_READY da origem',
    );
    expect(bundle.outputContract.instructions.join(' ')).toContain(
      'cada critério de aceite em ao menos um item de traceability',
    );
    expect(
      rawDeveloperRules.rules.find(({ id }) => id === 'developer:ambiguity')?.content,
    ).toContain('Nunca eleve a readiness recebida');
    expect(artifactSpecificationSchema.safeParse(bundle.artifactSpecification).success).toBe(true);
    expect(
      bundle.artifactSpecification.templates.map(
        ({ id, name, filename, type, format, mediaType }) => ({
          id,
          name,
          filename,
          type,
          format,
          mediaType,
        }),
      ),
    ).toEqual(CANONICAL_ARTIFACT_IDENTITIES);
  });

  it('states bidirectional Component and Module ownership normatively', () => {
    const rule = developerRuleContent('developer:component-module-ownership');
    const contractInstructions = rawOutputContract.instructions.join('\n');

    expect(rule).toContain('IF component.moduleIds');
    expect(rule).toContain('THEN esse Module MUST existir');
    expect(rule).toContain('IF um Module declara componentId');
    expect(rule).toContain('componentId MUST ser exatamente igual ao component.id');
    expect(rule).toContain('MUST NOT pertencer a mais de um Component');
    expect(contractInstructions).toContain('Ownership MUST ser bidirecional');
    expect(contractInstructions).toContain('Component MUST listar o Module em moduleIds');
  });

  it('states flow-step Component and Module ownership normatively', () => {
    const rule = developerRuleContent('developer:flow-step-ownership');
    const contractInstructions = rawOutputContract.instructions.join('\n');

    expect(rule).toContain('componentId que corresponda a um Component existente');
    expect(rule).toContain('IF um item de flow.steps declara um moduleId não nulo');
    expect(rule).toContain('THEN esse Module MUST existir');
    expect(rule).toContain('module.componentId MUST ser exatamente igual a step.componentId');
    expect(rule).toContain('MUST NOT usar um Module pertencente a outro Component');
    expect(contractInstructions).toContain('componentId que corresponda a um Component existente');
    expect(contractInstructions).toContain(
      'Module MUST existir e pertencer exatamente ao Component',
    );
  });

  it('states the no-change Data Model invariants normatively', () => {
    const rule = developerRuleContent('developer:data-model-no-change');
    const contractInstructions = rawOutputContract.instructions.join('\n');

    expect(rule).toContain('IF dataModel.changesRequired === false');
    expect(rule).toContain('dataModel.entities MUST ser []');
    expect(rule).toContain('dataModel.relations MUST ser []');
    expect(rule).toContain('dataModel.migrationRequired MUST ser false');
    expect(contractInstructions).toContain('IF dataModel.changesRequired === false');
    expect(contractInstructions).toContain('migrationRequired MUST ser false');
  });

  it('states the required-change Data Model and no-invention invariants normatively', () => {
    const changeRule = developerRuleContent('developer:data-model-change');
    const relationsRule = developerRuleContent('developer:data-model-relations');
    const evidenceRule = developerRuleContent('developer:data-model-evidence');
    const contractInstructions = rawOutputContract.instructions.join('\n');

    expect(changeRule).toContain('IF dataModel.changesRequired === true');
    expect(changeRule).toContain('dataModel.entities MUST conter pelo menos uma Entity');
    expect(changeRule).toContain('dataModel.relations MAY ser []');
    expect(relationsRule).toContain('IF dataModel.relations contém uma Relation');
    expect(relationsRule).toContain('sourceEntityId e relation.targetEntityId MUST referenciar');
    expect(relationsRule).toContain('MUST NOT apontar para uma Entity ausente');
    expect(evidenceRule).toContain('IF os requisitos funcionais não exigem alteração de dados');
    expect(evidenceRule).toContain('MUST NOT inventar Entity ou Relation');
    expect(contractInstructions).toContain('IF dataModel.changesRequired === true');
    expect(contractInstructions).toContain('sourceEntityId e targetEntityId MUST referenciar');
    expect(contractInstructions).toContain('Entity ou Relation MUST NOT ser inventada');
  });

  it('states safe module paths and UTF-16 length accounting normatively', () => {
    const pathRule = developerRuleContent('developer:safe-module-path');
    const unicodeRule = developerRuleContent('developer:utf16-length-limits');
    const contractInstructions = rawOutputContract.instructions.join('\n');

    expect(pathRule).toContain('modules[].path MUST ser relativo');
    expect(pathRule).toContain('normalizado em Unicode NFC');
    expect(pathRule).toContain('MUST NOT começar com / ou prefixo de drive');
    expect(pathRule).toContain('segmentos vazios, "." ou ".."');
    expect(unicodeRule).toContain('comprimento de string JavaScript UTF-16');
    expect(contractInstructions).toContain('modules[].path MUST ser relativo');
    expect(contractInstructions).toContain('caracteres Unicode suplementares contam como duas');
  });

  it('keeps the transport schema within the initial Structured Outputs subset', () => {
    const serializedSchema = JSON.stringify(rawOutputContract.schema);

    expect(release101OutputContract.schema).toEqual(historicalOutputContract.schema);
    expect(rawOutputContract.schema).not.toEqual(release101OutputContract.schema);
    expect(rawOutputContract.schema.type).toBe('object');
    expect(serializedSchema).not.toMatch(/"\$schema"\s*:/);
    expect(serializedSchema).not.toMatch(/"uniqueItems"\s*:/);
    expect(serializedSchema).not.toMatch(
      /"(?:allOf|oneOf|not|dependentRequired|dependentSchemas|if|then|else)"\s*:/,
    );
    expect(strictObjectSchemaViolations(rawOutputContract.schema)).toEqual([]);
  });

  it('pins the complete Artifact Specification and bundle content to release 1.0.2', () => {
    const valid = parseDeveloperPromptAssets(createSources());
    const tamperedSpecification = structuredClone(rawArtifactSpecification);
    const firstTemplate = tamperedSpecification.templates.at(0);
    if (firstTemplate === undefined || !('fragments' in firstTemplate)) {
      throw new Error('Expected the first canonical Developer artifact template to be textual.');
    }
    const firstFragment = firstTemplate.fragments.at(0);
    if (firstFragment?.kind === 'LITERAL') firstFragment.value = '# Arquitetura alterada — ';

    expect(valid.hashes.artifactSpecificationHash).toBe(
      '17cdec48313ec16aa3364885f5359b3c33bda6beef7af04cc2d743a50625887b',
    );
    expect(() =>
      parseDeveloperPromptAssets(replaceSource({ artifactSpecification: tamperedSpecification })),
    ).toThrowError('release Developer 1.0.2');
  });

  it.each(['../template.json', '/tmp/template.json', 'nested/template.json', ' template.json'])(
    'rejects unsafe or normalized manifest filename %j',
    (filename) => {
      const manifest = structuredClone(rawManifest);
      manifest.assets.template.filename = filename;

      expect(developerPromptAssetManifestSchema.safeParse(manifest).success).toBe(false);
    },
  );

  it('rejects manifest, template and rule-set wiring tampering', () => {
    const manifest = structuredClone(rawManifest);
    manifest.assets.outputContract.id = 'contract:other';
    const template = structuredClone(rawTemplate);
    const contextSlot = template.sections
      .flatMap((section) => section.blocks)
      .flatMap((block) => block.fragments)
      .find((fragment) => Object.hasOwn(fragment, 'contextId')) as
      { contextId: string } | undefined;
    if (contextSlot !== undefined) contextSlot.contextId = 'context:other';
    const developerRules = structuredClone(rawDeveloperRules);
    developerRules.agent = 'QA';

    expect(() => parseDeveloperPromptAssets(replaceSource({ manifest }))).toThrowError(
      DeveloperPromptAssetsError,
    );
    expect(() => parseDeveloperPromptAssets(replaceSource({ template }))).toThrowError(
      DeveloperPromptAssetsError,
    );
    expect(() => parseDeveloperPromptAssets(replaceSource({ developerRules }))).toThrowError(
      DeveloperPromptAssetsError,
    );
  });

  it('keeps code and tests outside the Developer output and artifact contracts', () => {
    const developerRules = rawDeveloperRules.rules.map(({ content }) => content).join('\n');
    const artifactFilenames = rawArtifactSpecification.templates.map(({ filename }) => filename);

    expect(developerRules).toContain('não escreva código-fonte');
    expect(developerRules).toContain('testes automatizados');
    expect(developerRules).toContain('Não afirme que arquivos foram criados');
    expect(artifactFilenames).toEqual([
      'architecture.md',
      'implementation-plan.md',
      'technical-decisions.json',
    ]);
    expect(Object.keys(rawOutputContract.schema.properties)).toEqual(
      expect.not.arrayContaining(['code', 'sourceCode', 'tests', 'commands']),
    );
  });

  it('contains no provider secrets or transport credentials in declarative assets', () => {
    const serialized = JSON.stringify(createSources());

    expect(serialized).not.toMatch(/(?:sk-[A-Za-z0-9_-]{12,}|OPENAI_API_KEY)/);
    expect(serialized).not.toMatch(/"(?:apiKey|authorization|cookie|password|secret)"\s*:/i);
  });
});
