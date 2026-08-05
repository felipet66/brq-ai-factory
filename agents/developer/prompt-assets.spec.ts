import { artifactSpecificationSchema } from '@brq/artifact-generator';
import { calculateCanonicalJsonHash } from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import rawArtifactSpecification from '../../prompts/developer/1.0.0/artifact-specification.json' with { type: 'json' };
import rawDeveloperRules from '../../prompts/developer/1.0.0/developer-rules.json' with { type: 'json' };
import rawGlobalRules from '../../prompts/developer/1.0.0/global-rules.json' with { type: 'json' };
import rawManifest from '../../prompts/developer/1.0.0/manifest.json' with { type: 'json' };
import rawOutputContract from '../../prompts/developer/1.0.0/output-contract.json' with { type: 'json' };
import rawSecurityRules from '../../prompts/developer/1.0.0/security-rules.json' with { type: 'json' };
import rawTemplate from '../../prompts/developer/1.0.0/template.json' with { type: 'json' };

import {
  DeveloperPromptAssetsError,
  developerPromptAssetManifestSchema,
  loadDeveloperPromptAssets,
  parseDeveloperPromptAssets,
  type DeveloperPromptAssetSources,
  validateDeveloperPromptAssets,
} from './prompt-assets';

const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const DEVELOPER_BUNDLE_1_0_0_HASH =
  'dce834b162f084da261115def47e5b9f6e2c2f926279e5ab7be367b2185df039';
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
      version: '1.0.0',
      schemaVersion: '1.0.0',
      agent: 'DEVELOPER',
      contexts: {
        knowledge: 'context:developer-knowledge',
        productOwnerSpecification: 'context:product-owner-specification',
      },
    });
    expect(bundle.template).toMatchObject({
      id: 'prompt:developer',
      version: '1.0.0',
      agent: 'DEVELOPER',
    });
    expect(bundle.ruleSets.map(({ id, scope, agent }) => ({ id, scope, agent }))).toEqual([
      { id: 'rules:global-baseline', scope: 'GLOBAL', agent: null },
      { id: 'rules:security-baseline', scope: 'SECURITY', agent: null },
      { id: 'rules:developer', scope: 'AGENT', agent: 'DEVELOPER' },
    ]);
    expect(bundle.outputContract).toMatchObject({
      id: 'contract:developer-technical-specification',
      version: '1.0.0',
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
    expect(loadDeveloperPromptAssets()).toBe(bundle);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.template.sections)).toBe(true);
    expect(Object.isFrozen(bundle.artifactSpecification.templates)).toBe(true);
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
    expect(first.hashes.bundleHash).toBe(DEVELOPER_BUNDLE_1_0_0_HASH);
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

  it('keeps the transport schema within the initial Structured Outputs subset', () => {
    const serializedSchema = JSON.stringify(rawOutputContract.schema);

    expect(rawOutputContract.schema.type).toBe('object');
    expect(serializedSchema).not.toMatch(/"\$schema"\s*:/);
    expect(serializedSchema).not.toMatch(/"uniqueItems"\s*:/);
    expect(serializedSchema).not.toMatch(
      /"(?:allOf|oneOf|not|dependentRequired|dependentSchemas|if|then|else)"\s*:/,
    );
    expect(strictObjectSchemaViolations(rawOutputContract.schema)).toEqual([]);
  });

  it('pins the complete Artifact Specification and bundle content to release 1.0.0', () => {
    const valid = parseDeveloperPromptAssets(createSources());
    const tamperedSpecification = structuredClone(rawArtifactSpecification);
    const firstTemplate = tamperedSpecification.templates.at(0);
    if (firstTemplate === undefined || !('fragments' in firstTemplate)) {
      throw new Error('Expected the first canonical Developer artifact template to be textual.');
    }
    const firstFragment = firstTemplate.fragments.at(0);
    if (firstFragment?.kind === 'LITERAL') firstFragment.value = '# Arquitetura alterada — ';

    expect(valid.hashes.artifactSpecificationHash).toBe(
      '3b921a27e9c88740f16764e8f484a5807fecb5e64e503d9d4c07e9940cf46188',
    );
    expect(() =>
      parseDeveloperPromptAssets(replaceSource({ artifactSpecification: tamperedSpecification })),
    ).toThrowError('release Developer 1.0.0');
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
