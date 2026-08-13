import { artifactSpecificationSchema } from '@brq/artifact-generator';
import { calculateCanonicalJsonHash } from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import historicalArtifactSpecification from '../../prompts/product-owner/1.0.0/artifact-specification.json' with { type: 'json' };
import historicalGlobalRules from '../../prompts/product-owner/1.0.0/global-rules.json' with { type: 'json' };
import historicalManifest from '../../prompts/product-owner/1.0.0/manifest.json' with { type: 'json' };
import historicalOutputContract from '../../prompts/product-owner/1.0.0/output-contract.json' with { type: 'json' };
import historicalProductOwnerRules from '../../prompts/product-owner/1.0.0/product-owner-rules.json' with { type: 'json' };
import historicalSecurityRules from '../../prompts/product-owner/1.0.0/security-rules.json' with { type: 'json' };
import historicalTemplate from '../../prompts/product-owner/1.0.0/template.json' with { type: 'json' };
import historical101ArtifactSpecification from '../../prompts/product-owner/1.0.1/artifact-specification.json' with { type: 'json' };
import historical101GlobalRules from '../../prompts/product-owner/1.0.1/global-rules.json' with { type: 'json' };
import historical101Manifest from '../../prompts/product-owner/1.0.1/manifest.json' with { type: 'json' };
import historical101OutputContract from '../../prompts/product-owner/1.0.1/output-contract.json' with { type: 'json' };
import historical101ProductOwnerRules from '../../prompts/product-owner/1.0.1/product-owner-rules.json' with { type: 'json' };
import historical101SecurityRules from '../../prompts/product-owner/1.0.1/security-rules.json' with { type: 'json' };
import historical101Template from '../../prompts/product-owner/1.0.1/template.json' with { type: 'json' };
import rawArtifactSpecification from '../../prompts/product-owner/1.0.2/artifact-specification.json' with { type: 'json' };
import rawGlobalRules from '../../prompts/product-owner/1.0.2/global-rules.json' with { type: 'json' };
import rawManifest from '../../prompts/product-owner/1.0.2/manifest.json' with { type: 'json' };
import rawOutputContract from '../../prompts/product-owner/1.0.2/output-contract.json' with { type: 'json' };
import rawProductOwnerRules from '../../prompts/product-owner/1.0.2/product-owner-rules.json' with { type: 'json' };
import rawSecurityRules from '../../prompts/product-owner/1.0.2/security-rules.json' with { type: 'json' };
import rawTemplate from '../../prompts/product-owner/1.0.2/template.json' with { type: 'json' };

import {
  loadProductOwnerPromptAssets,
  parseProductOwnerPromptAssets,
  ProductOwnerPromptAssetsError,
  productOwnerPromptAssetManifestSchema,
  type ProductOwnerPromptAssetSources,
  validateProductOwnerPromptAssets,
} from './prompt-assets';

const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const PRODUCT_OWNER_BUNDLE_1_0_2_HASH =
  '69b9dc4313a586103250636c05a89d4776703d9ad2afd33593c508799576c29a';
const HISTORICAL_PRODUCT_OWNER_1_0_0_HASHES = {
  manifest: '24bf6cf1b4189658aab7b981e512869621c62856ac481a47ab9b6af3de0cbf25',
  template: '1ae371f673885b38d6218fa01ecd16a4e1d2ffa2d68e1f7cdee7143365257b16',
  globalRules: 'eaa5d555158cdba2cb5229d81a7917d5e0d8d0591b309c9229195fbdbf8f2715',
  securityRules: '0177cbe77feaa7ef6a46b414c0ea6fc025fabc3aa84e9ece98c7cf126478fbbc',
  productOwnerRules: '785978b6f29d6eb3c3f208fd4391f0b3cdae5fef45b6685997ea61af2e41a501',
  outputContract: '1924336aafb19f8dd042784c0437486ad43312c6d83abe39531cee35b5fdf8d7',
  artifactSpecification: '9cbeb1bcf59bff3872f63750bf2a2c150b3d4832a1a171d7c5b9beffd15e858e',
} as const;
const HISTORICAL_PRODUCT_OWNER_1_0_1_HASHES = {
  manifest: '2536186a85bff696f92af9dd41f651f187463004332af26c4903df865ed43210',
  template: 'c1951f227d47b31784b5acf560c6fdfd9ed96de144c487dabf6e969c4e6041a3',
  globalRules: 'eaa5d555158cdba2cb5229d81a7917d5e0d8d0591b309c9229195fbdbf8f2715',
  securityRules: '0177cbe77feaa7ef6a46b414c0ea6fc025fabc3aa84e9ece98c7cf126478fbbc',
  productOwnerRules: '97ab120b4abad544a371f40df1c09a72f1bfb41b5c44793965a4e930f35fad5f',
  outputContract: 'edca2491368f9b9288ad00cddaaf0f387ee3a569939590877a14894e882dab07',
  artifactSpecification: '077e40ca61773a9a60dd3bcfe683fc793a7180409dafaaad076725c04bee5a87',
} as const;
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

function productOwnerRuleContent(id: string): string {
  const rule = rawProductOwnerRules.rules.find((candidate) => candidate.id === id);
  if (rule === undefined) throw new Error(`Expected Product Owner rule ${id}.`);
  return rule.content;
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
      version: '1.0.2',
      schemaVersion: '1.0.0',
      agent: 'PRODUCT_OWNER',
    });
    expect(bundle.template).toMatchObject({
      id: 'prompt:product-owner',
      version: '1.0.2',
      agent: 'PRODUCT_OWNER',
    });
    expect(
      bundle.ruleSets.map(({ id, version, scope, agent }) => ({ id, version, scope, agent })),
    ).toEqual([
      { id: 'rules:global-baseline', version: '1.0.0', scope: 'GLOBAL', agent: null },
      { id: 'rules:security-baseline', version: '1.0.0', scope: 'SECURITY', agent: null },
      {
        id: 'rules:product-owner',
        version: '1.0.2',
        scope: 'AGENT',
        agent: 'PRODUCT_OWNER',
      },
    ]);
    expect(bundle.outputContract).toMatchObject({
      id: 'contract:product-owner-specification',
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
    expect(bundle.artifactSpecification.templates.map(({ filename }) => filename)).toEqual(
      CANONICAL_ARTIFACT_FILENAMES,
    );
    expect(bundle.artifactSpecification.version).toBe('1.0.2');
    expect(loadProductOwnerPromptAssets()).toBe(bundle);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.template.sections)).toBe(true);
    expect(Object.isFrozen(bundle.artifactSpecification.templates)).toBe(true);
  });

  it('preserves the immutable Product Owner 1.0.0 and 1.0.1 assets while activating 1.0.2', () => {
    const historical100Hashes = {
      manifest: calculateCanonicalJsonHash(historicalManifest as unknown as JsonValue),
      template: calculateCanonicalJsonHash(historicalTemplate as unknown as JsonValue),
      globalRules: calculateCanonicalJsonHash(historicalGlobalRules as unknown as JsonValue),
      securityRules: calculateCanonicalJsonHash(historicalSecurityRules as unknown as JsonValue),
      productOwnerRules: calculateCanonicalJsonHash(
        historicalProductOwnerRules as unknown as JsonValue,
      ),
      outputContract: calculateCanonicalJsonHash(historicalOutputContract as unknown as JsonValue),
      artifactSpecification: calculateCanonicalJsonHash(
        historicalArtifactSpecification as unknown as JsonValue,
      ),
    };
    const historical101Hashes = {
      manifest: calculateCanonicalJsonHash(historical101Manifest as unknown as JsonValue),
      template: calculateCanonicalJsonHash(historical101Template as unknown as JsonValue),
      globalRules: calculateCanonicalJsonHash(historical101GlobalRules as unknown as JsonValue),
      securityRules: calculateCanonicalJsonHash(historical101SecurityRules as unknown as JsonValue),
      productOwnerRules: calculateCanonicalJsonHash(
        historical101ProductOwnerRules as unknown as JsonValue,
      ),
      outputContract: calculateCanonicalJsonHash(
        historical101OutputContract as unknown as JsonValue,
      ),
      artifactSpecification: calculateCanonicalJsonHash(
        historical101ArtifactSpecification as unknown as JsonValue,
      ),
    };

    expect(historicalManifest.version).toBe('1.0.0');
    expect(historical100Hashes).toEqual(HISTORICAL_PRODUCT_OWNER_1_0_0_HASHES);
    expect(historical101Manifest.version).toBe('1.0.1');
    expect(historical101Hashes).toEqual(HISTORICAL_PRODUCT_OWNER_1_0_1_HASHES);
    expect(loadProductOwnerPromptAssets().manifest.version).toBe('1.0.2');
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
    expect(first.hashes.bundleHash).toBe(PRODUCT_OWNER_BUNDLE_1_0_2_HASH);
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

  it('states the backlog dependency reference invariant normatively across prompt assets', () => {
    const rule = productOwnerRuleContent('product-owner:dependency-references');
    const contractInstructions = rawOutputContract.instructions.join('\n');

    expect(rule).toContain('backlogItems[].dependencyIds MUST corresponder exatamente');
    expect(rule).toContain('dependencies[].id');
    expect(rule).toContain('MUST NOT referenciar um identificador DEP');
    expect(rule).toContain('IF um backlog item não possui dependências declaradas');
    expect(rule).toContain('THEN dependencyIds MUST ser []');
    expect(contractInstructions).toContain(
      'backlogItems[].dependencyIds MUST corresponder exatamente',
    );
    expect(contractInstructions).toContain('Um identificador DEP não declarado MUST NOT');
    expect(contractInstructions).toContain('THEN dependencyIds MUST ser []');
  });

  it('defines concrete uncertainty eligibility and the final readiness preflight explicitly', () => {
    const rules = rawProductOwnerRules.rules.map(({ content }) => content).join('\n');
    const contractInstructions = rawOutputContract.instructions.join('\n');
    const trustedTemplate = JSON.stringify(rawTemplate);

    expect(productOwnerRuleContent('product-owner:uncertainty-eligibility')).toContain(
      'decisão concreta não resolvida',
    );
    expect(rules).toContain('escopo, regra de negócio, critério de aceite, integração externa');
    expect(rules).toContain('segurança, privacidade ou obrigação legal');
    expect(rules).toContain('MUST NOT gerar openQuestions');
    expect(productOwnerRuleContent('product-owner:validation-eligibility')).toContain(
      'confirmação humana ou de terceiro',
    );
    expect(productOwnerRuleContent('product-owner:greenfield-readiness')).toContain(
      'deliveryIntent.mode como indicador host-owned projetado no input',
    );
    expect(productOwnerRuleContent('product-owner:greenfield-readiness')).toContain(
      'deliveryIntent.mode === "GREENFIELD"',
    );
    expect(productOwnerRuleContent('product-owner:greenfield-readiness')).toContain(
      'default funcional mínimo',
    );
    expect(productOwnerRuleContent('product-owner:greenfield-readiness')).toContain(
      'não inventa fato, regra, dependência ou integração e não amplia o escopo',
    );
    expect(productOwnerRuleContent('product-owner:real-uncertainty')).toContain(
      'REQUIRES_CLARIFICATION',
    );
    expect(productOwnerRuleContent('product-owner:real-uncertainty')).toContain('PARTIALLY_READY');
    expect(productOwnerRuleContent('product-owner:readiness-preflight')).toContain(
      'readiness MUST ser READY',
    );
    expect(contractInstructions).toContain('Antes do JSON final, execute o preflight');
    expect(contractInstructions).toContain(
      'deliveryIntent.mode como indicador host-owned projetado no input',
    );
    expect(trustedTemplate).toContain('Antes de emitir o JSON final, execute o preflight');
    expect(trustedTemplate).toContain('deliveryIntent.mode === \\"GREENFIELD\\"');
    expect(trustedTemplate).not.toContain('tornando explícitas todas as lacunas relevantes');
    expect(trustedTemplate).not.toContain('registre ambiguidades como dúvidas abertas');
    expect(rules).not.toContain('Registre toda ambiguidade relevante');
  });

  it('keeps the transport schema within the initial Structured Outputs subset', () => {
    const serializedSchema = JSON.stringify(rawOutputContract.schema);

    expect(rawOutputContract.schema).toEqual(historical101OutputContract.schema);
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

  it('pins the complete Artifact Specification content to release 1.0.2', () => {
    const valid = parseProductOwnerPromptAssets(createSources());
    const identityTampering = structuredClone(rawArtifactSpecification);
    identityTampering.templates[0]!.type = 'PRODUCT_OWNER_UNEXPECTED';
    const bindingTampering = structuredClone(rawArtifactSpecification);
    const storyTemplate = bindingTampering.templates[0];
    const storyFragments = storyTemplate?.fragments;
    if (storyFragments !== undefined) {
      storyFragments[0] = { kind: 'LITERAL', value: '# Conteúdo adulterado ' };
    }

    expect(valid.hashes.artifactSpecificationHash).toBe(
      'ada2543848efba9b83f89fa44a09166431c830e6c6f59eb32e37dc512739c426',
    );
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
