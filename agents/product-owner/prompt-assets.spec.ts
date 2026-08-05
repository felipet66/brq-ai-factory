import { artifactSpecificationSchema } from '@brq/artifact-generator';
import { calculateCanonicalJsonHash } from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import rawArtifactSpecification from '../../prompts/product-owner/1.0.0/artifact-specification.json' with { type: 'json' };
import rawGlobalRules from '../../prompts/product-owner/1.0.0/global-rules.json' with { type: 'json' };
import rawManifest from '../../prompts/product-owner/1.0.0/manifest.json' with { type: 'json' };
import rawOutputContract from '../../prompts/product-owner/1.0.0/output-contract.json' with { type: 'json' };
import rawProductOwnerRules from '../../prompts/product-owner/1.0.0/product-owner-rules.json' with { type: 'json' };
import rawSecurityRules from '../../prompts/product-owner/1.0.0/security-rules.json' with { type: 'json' };
import rawTemplate from '../../prompts/product-owner/1.0.0/template.json' with { type: 'json' };

import {
  loadProductOwnerPromptAssets,
  parseProductOwnerPromptAssets,
  ProductOwnerPromptAssetsError,
  productOwnerPromptAssetManifestSchema,
  type ProductOwnerPromptAssetSources,
  validateProductOwnerPromptAssets,
} from './prompt-assets';

const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const PRODUCT_OWNER_BUNDLE_1_0_0_HASH =
  '6dc7173489ab0cecd939316fd5ebbc325c1b90f18111a718a9c7e62c0b408186';
const CANONICAL_ARTIFACT_FILENAMES = ['story.md', 'acceptance.md', 'backlog.json'];
const SPECIFICATION_PROPERTIES = [
  'readiness',
  'title',
  'summary',
  'objective',
  'context',
  'userStory',
  'acceptanceCriteria',
  'businessRules',
  'scenarios',
  'assumptions',
  'dependencies',
  'risks',
  'openQuestions',
  'outOfScope',
  'definitionOfReady',
  'backlogItems',
] as const;

function createSources(): ProductOwnerPromptAssetSources {
  return structuredClone({
    manifest: rawManifest,
    template: rawTemplate,
    globalRules: rawGlobalRules,
    securityRules: rawSecurityRules,
    productOwnerRules: rawProductOwnerRules,
    outputContract: rawOutputContract,
    artifactSpecification: rawArtifactSpecification,
  });
}

function replaceSource(
  replacement: Partial<ProductOwnerPromptAssetSources>,
): ProductOwnerPromptAssetSources {
  return { ...createSources(), ...replacement };
}

function strictObjectSchemaViolations(value: unknown, path = '$'): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      strictObjectSchemaViolations(entry, `${path}[${index}]`),
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

    if (record['additionalProperties'] !== false)
      ownViolations.push(`${path}.additionalProperties`);
    if (
      required.length !== propertyNames.length ||
      propertyNames.some((property) => !required.includes(property))
    ) {
      ownViolations.push(`${path}.required`);
    }
  }

  return [
    ...ownViolations,
    ...Object.entries(record).flatMap(([key, nested]) =>
      strictObjectSchemaViolations(nested, `${path}.${key}`),
    ),
  ];
}

describe('Product Owner prompt assets', () => {
  it('loads the immutable, versioned Product Owner bundle', () => {
    const bundle = loadProductOwnerPromptAssets();

    expect(bundle.manifest).toMatchObject({
      id: 'assets:product-owner',
      version: '1.0.0',
      schemaVersion: '1.0.0',
      agent: 'PRODUCT_OWNER',
    });
    expect(bundle.template).toMatchObject({
      id: 'prompt:product-owner',
      version: '1.0.0',
      agent: 'PRODUCT_OWNER',
    });
    expect(bundle.ruleSets.map(({ id, scope, agent }) => ({ id, scope, agent }))).toEqual([
      { id: 'rules:global-baseline', scope: 'GLOBAL', agent: null },
      { id: 'rules:security-baseline', scope: 'SECURITY', agent: null },
      { id: 'rules:product-owner', scope: 'AGENT', agent: 'PRODUCT_OWNER' },
    ]);
    expect(bundle.outputContract).toMatchObject({
      id: 'contract:product-owner-specification',
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
    expect(bundle.artifactSpecification.templates.map(({ filename }) => filename)).toEqual(
      CANONICAL_ARTIFACT_FILENAMES,
    );
    expect(loadProductOwnerPromptAssets()).toBe(bundle);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.template.sections)).toBe(true);
    expect(Object.isFrozen(bundle.artifactSpecification.templates)).toBe(true);
  });

  it('produces deterministic canonical hashes and preserves asset order', () => {
    const first = parseProductOwnerPromptAssets(createSources());
    const second = parseProductOwnerPromptAssets(createSources());
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
    expect(first.hashes.bundleHash).toBe(PRODUCT_OWNER_BUNDLE_1_0_0_HASH);
    expect(hashes).toHaveLength(9);
    expect(hashes.every((hash) => SHA_256_HEX_PATTERN.test(hash))).toBe(true);
    expect(first.hashes.ruleSetHashes.map(({ ruleSetId }) => ruleSetId)).toEqual([
      'rules:global-baseline',
      'rules:security-baseline',
      'rules:product-owner',
    ]);
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
    const valid = parseProductOwnerPromptAssets(createSources());
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

    expect(validateProductOwnerPromptAssets(valid)).toEqual(valid);
    expect(() => validateProductOwnerPromptAssets(tamperedHash)).toThrowError(
      ProductOwnerPromptAssetsError,
    );
    expect(() => validateProductOwnerPromptAssets(tamperedValidationContract)).toThrowError(
      ProductOwnerPromptAssetsError,
    );
  });

  it('keeps the output JSON Schema aligned with the canonical domain shape', () => {
    const bundle = loadProductOwnerPromptAssets();
    const schema = bundle.outputContract.schema as {
      readonly additionalProperties: boolean;
      readonly properties: Readonly<Record<string, unknown>>;
      readonly required: readonly string[];
    };
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toEqual(SPECIFICATION_PROPERTIES);
    expect(schema.required).toEqual(SPECIFICATION_PROPERTIES);
  });

  it('keeps the transport schema within the initial Structured Outputs subset', () => {
    const serializedSchema = JSON.stringify(rawOutputContract.schema);

    expect(rawOutputContract.schema.type).toBe('object');
    expect(serializedSchema).not.toMatch(/"\$schema"\s*:/);
    expect(serializedSchema).not.toMatch(/"uniqueItems"\s*:/);
    expect(serializedSchema).not.toMatch(
      /"(?:allOf|oneOf|not|dependentRequired|dependentSchemas)"\s*:/,
    );
    expect(strictObjectSchemaViolations(rawOutputContract.schema)).toEqual([]);
  });

  it('keeps the Artifact Specification valid and limited to the three canonical artifacts', () => {
    const bundle = loadProductOwnerPromptAssets();

    expect(artifactSpecificationSchema.safeParse(bundle.artifactSpecification).success).toBe(true);
    expect(bundle.artifactSpecification.templates).toHaveLength(3);
    expect(bundle.artifactSpecification.templates.map(({ filename }) => filename)).toEqual(
      CANONICAL_ARTIFACT_FILENAMES,
    );
    expect(bundle.artifactSpecification.templates.map(({ format }) => format)).toEqual([
      'TEXT',
      'TEXT',
      'JSON',
    ]);
  });

  it.each(['../template.json', '/tmp/template.json', 'nested/template.json', ' template.json'])(
    'rejects unsafe or normalized manifest filename %j',
    (filename) => {
      const manifest = structuredClone(rawManifest);
      manifest.assets.template.filename = filename;

      expect(productOwnerPromptAssetManifestSchema.safeParse(manifest).success).toBe(false);
    },
  );

  it('rejects a manifest reference that does not match the loaded asset', () => {
    const manifest = structuredClone(rawManifest);
    manifest.assets.template.id = 'prompt:another-agent';

    expect(() => parseProductOwnerPromptAssets(replaceSource({ manifest }))).toThrowError(
      ProductOwnerPromptAssetsError,
    );
  });

  it('rejects invalid rule-set boundaries and template context wiring', () => {
    const securityRules = { ...structuredClone(rawSecurityRules), agent: 'PRODUCT_OWNER' };
    const template = structuredClone(rawTemplate) as unknown as {
      sections: Array<{
        blocks: Array<{ fragments: Array<Record<string, unknown>> }>;
      }>;
    };
    const contextFragment = template.sections
      .flatMap(({ blocks }) => blocks)
      .flatMap(({ fragments }) => fragments)
      .find(({ type }) => type === 'CONTEXT_SLOT');

    expect(contextFragment).toBeDefined();
    if (contextFragment?.['type'] === 'CONTEXT_SLOT') {
      contextFragment.contextId = 'context:unexpected';
    }

    expect(() => parseProductOwnerPromptAssets(replaceSource({ securityRules }))).toThrowError(
      ProductOwnerPromptAssetsError,
    );
    expect(() => parseProductOwnerPromptAssets(replaceSource({ template }))).toThrowError(
      ProductOwnerPromptAssetsError,
    );
  });

  it('rejects contract and artifact tampering across the validation boundary', () => {
    const outputContract = structuredClone(rawOutputContract);
    outputContract.instructions = [...outputContract.instructions, 'Instrução adulterada.'];
    const artifactSpecification = structuredClone(rawArtifactSpecification);
    artifactSpecification.templates[0]!.filename = 'unexpected.md';

    expect(() => parseProductOwnerPromptAssets(replaceSource({ outputContract }))).toThrowError(
      ProductOwnerPromptAssetsError,
    );
    expect(() =>
      parseProductOwnerPromptAssets(replaceSource({ artifactSpecification })),
    ).toThrowError(ProductOwnerPromptAssetsError);
  });

  it('pins the complete Artifact Specification content to release 1.0.0', () => {
    const identityTampering = structuredClone(rawArtifactSpecification);
    identityTampering.templates[0]!.type = 'PRODUCT_OWNER_UNEXPECTED';
    const bindingTampering = structuredClone(rawArtifactSpecification);
    const storyTemplate = bindingTampering.templates[0];
    const storyFragments = storyTemplate?.fragments;
    if (storyFragments !== undefined) {
      storyFragments[0] = { kind: 'LITERAL', value: '# Conteúdo adulterado ' };
    }

    expect(() =>
      parseProductOwnerPromptAssets(replaceSource({ artifactSpecification: identityTampering })),
    ).toThrowError(ProductOwnerPromptAssetsError);
    expect(() =>
      parseProductOwnerPromptAssets(replaceSource({ artifactSpecification: bindingTampering })),
    ).toThrowError(ProductOwnerPromptAssetsError);
  });

  it('contains no provider secrets or transport credentials in declarative assets', () => {
    const serializedAssets = JSON.stringify(createSources());

    expect(serializedAssets).not.toMatch(/authorization|api[_-]?key|cookie|bearer\s/i);
    expect(serializedAssets).not.toMatch(/sk-[a-z0-9_-]+/i);
  });
});
