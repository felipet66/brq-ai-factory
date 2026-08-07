import { artifactSpecificationSchema, type ArtifactSpecification } from '@brq/artifact-generator';
import {
  calculateCanonicalJsonHash,
  promptNodeIdSchema,
  promptOutputContractSchema,
  promptRuleSetSchema,
  promptTemplateSchema,
  type PromptOutputContract,
  type PromptRuleSet,
  type PromptTemplate,
} from '@brq/prompt-builder';
import { validationContractSchema, type ValidationContract } from '@brq/response-validator';
import { safeFilenameSchema, semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import type { JsonValue } from '@brq/shared/types/json-value';
import { z } from 'zod';

import rawArtifactSpecification from '../../prompts/product-owner/1.0.1/artifact-specification.json' with { type: 'json' };
import rawGlobalRules from '../../prompts/product-owner/1.0.1/global-rules.json' with { type: 'json' };
import rawManifest from '../../prompts/product-owner/1.0.1/manifest.json' with { type: 'json' };
import rawOutputContract from '../../prompts/product-owner/1.0.1/output-contract.json' with { type: 'json' };
import rawProductOwnerRules from '../../prompts/product-owner/1.0.1/product-owner-rules.json' with { type: 'json' };
import rawSecurityRules from '../../prompts/product-owner/1.0.1/security-rules.json' with { type: 'json' };
import rawTemplate from '../../prompts/product-owner/1.0.1/template.json' with { type: 'json' };
import { deepFreeze } from './immutability';

const PRODUCT_OWNER_AGENT = 'PRODUCT_OWNER' as const;
const PRODUCT_OWNER_ASSET_FILENAMES = {
  template: 'template.json',
  globalRules: 'global-rules.json',
  securityRules: 'security-rules.json',
  productOwnerRules: 'product-owner-rules.json',
  outputContract: 'output-contract.json',
  artifactSpecification: 'artifact-specification.json',
} as const;
const PRODUCT_OWNER_ARTIFACT_FILENAMES = ['story.md', 'acceptance.md', 'backlog.json'] as const;
const PRODUCT_OWNER_RELEASE_1_0_1_BUNDLE_HASH =
  '32d7454be1bb61eb6dbe28bd582d943bed76c9fbd501d631e13e0bd69d4a8275';
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const assetFilenameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((filename) => filename === filename.trim(), 'O filename não pode ser normalizado.')
  .pipe(safeFilenameSchema)
  .refine((filename) => filename.endsWith('.json'), 'Um asset de prompt deve ser um arquivo JSON.');

const assetReferenceBase = {
  filename: assetFilenameSchema,
  id: promptNodeIdSchema,
  version: semanticVersionSchema,
};

const promptAssetReferenceSchema = z.object(assetReferenceBase).strict();
const ruleSetAssetReferenceSchema = z
  .object({ ...assetReferenceBase, scope: z.enum(['GLOBAL', 'SECURITY', 'AGENT']) })
  .strict();

export const productOwnerPromptAssetManifestSchema = z
  .object({
    id: promptNodeIdSchema,
    version: semanticVersionSchema,
    schemaVersion: semanticVersionSchema,
    agent: z.literal(PRODUCT_OWNER_AGENT),
    contexts: z
      .object({
        knowledge: promptNodeIdSchema,
        request: promptNodeIdSchema,
      })
      .strict(),
    assets: z
      .object({
        template: promptAssetReferenceSchema,
        ruleSets: z.array(ruleSetAssetReferenceSchema).length(3),
        outputContract: promptAssetReferenceSchema,
        artifactSpecification: promptAssetReferenceSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const references = [
      manifest.assets.template,
      ...manifest.assets.ruleSets,
      manifest.assets.outputContract,
      manifest.assets.artifactSpecification,
    ];
    const identifiers = new Set<string>();
    const filenames = new Set<string>();

    references.forEach((reference, index) => {
      if (identifiers.has(reference.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Os IDs dos assets devem ser únicos.',
          path: ['assets', index, 'id'],
        });
      }
      if (filenames.has(reference.filename)) {
        context.addIssue({
          code: 'custom',
          message: 'Os filenames dos assets devem ser únicos.',
          path: ['assets', index, 'filename'],
        });
      }
      identifiers.add(reference.id);
      filenames.add(reference.filename);
    });

    if (manifest.contexts.knowledge === manifest.contexts.request) {
      context.addIssue({
        code: 'custom',
        message: 'Os contextos de conhecimento e demanda devem possuir IDs distintos.',
        path: ['contexts'],
      });
    }
  });

export type ProductOwnerPromptAssetManifest = Readonly<
  z.infer<typeof productOwnerPromptAssetManifestSchema>
>;

export interface ProductOwnerPromptAssetSources {
  readonly manifest: unknown;
  readonly template: unknown;
  readonly globalRules: unknown;
  readonly securityRules: unknown;
  readonly productOwnerRules: unknown;
  readonly outputContract: unknown;
  readonly artifactSpecification: unknown;
}

export interface ProductOwnerRuleSetHash {
  readonly ruleSetId: string;
  readonly hash: string;
}

export interface ProductOwnerPromptAssetHashes {
  readonly manifestHash: string;
  readonly templateHash: string;
  readonly ruleSetHashes: readonly ProductOwnerRuleSetHash[];
  readonly outputContractHash: string;
  readonly validationContractHash: string;
  readonly artifactSpecificationHash: string;
  readonly bundleHash: string;
}

export interface ProductOwnerPromptAssets {
  readonly manifest: ProductOwnerPromptAssetManifest;
  readonly template: PromptTemplate;
  readonly ruleSets: readonly PromptRuleSet[];
  readonly outputContract: Extract<PromptOutputContract, { readonly format: 'JSON_SCHEMA' }>;
  readonly validationContract: Extract<ValidationContract, { readonly format: 'JSON_SCHEMA' }>;
  readonly artifactSpecification: ArtifactSpecification;
  readonly hashes: ProductOwnerPromptAssetHashes;
}

const productOwnerPromptAssetHashesSchema = z
  .object({
    manifestHash: hashSchema,
    templateHash: hashSchema,
    ruleSetHashes: z
      .array(
        z
          .object({
            ruleSetId: promptNodeIdSchema,
            hash: hashSchema,
          })
          .strict(),
      )
      .length(3),
    outputContractHash: hashSchema,
    validationContractHash: hashSchema,
    artifactSpecificationHash: hashSchema,
    bundleHash: hashSchema,
  })
  .strict();

const productOwnerPromptAssetsSchema = z
  .object({
    manifest: productOwnerPromptAssetManifestSchema,
    template: promptTemplateSchema,
    ruleSets: z.array(promptRuleSetSchema).length(3),
    outputContract: promptOutputContractSchema,
    validationContract: validationContractSchema,
    artifactSpecification: artifactSpecificationSchema,
    hashes: productOwnerPromptAssetHashesSchema,
  })
  .strict();

export const PRODUCT_OWNER_PROMPT_ASSET_ERROR_CODE = 'PRODUCT_OWNER_PROMPT_ASSETS_INVALID';

export class ProductOwnerPromptAssetsError extends Error {
  readonly code = PRODUCT_OWNER_PROMPT_ASSET_ERROR_CODE;

  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ProductOwnerPromptAssetsError';
  }
}

function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new ProductOwnerPromptAssetsError(message);
}

function assertArrayEqual(
  actual: readonly string[],
  expected: readonly string[],
  message: string,
): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new ProductOwnerPromptAssetsError(message);
  }
}

function parseManifest(input: unknown): ProductOwnerPromptAssetManifest {
  const result = productOwnerPromptAssetManifestSchema.safeParse(input);
  if (!result.success) {
    throw new ProductOwnerPromptAssetsError('Manifesto de assets do Product Owner inválido.', {
      cause: result.error,
    });
  }
  return result.data;
}

function assertReference(
  reference: z.infer<typeof promptAssetReferenceSchema>,
  asset: { readonly id: string; readonly version: string },
  expectedFilename: string,
): void {
  assertEqual(reference.filename, expectedFilename, 'O manifesto referencia um filename inválido.');
  assertEqual(reference.id, asset.id, 'O ID do asset não corresponde ao manifesto.');
  assertEqual(reference.version, asset.version, 'A versão do asset não corresponde ao manifesto.');
}

function assertRuleSetReferences(
  manifest: ProductOwnerPromptAssetManifest,
  ruleSets: readonly PromptRuleSet[],
): void {
  const expectedFilenames = [
    PRODUCT_OWNER_ASSET_FILENAMES.globalRules,
    PRODUCT_OWNER_ASSET_FILENAMES.securityRules,
    PRODUCT_OWNER_ASSET_FILENAMES.productOwnerRules,
  ];

  manifest.assets.ruleSets.forEach((reference, index) => {
    const ruleSet = ruleSets[index];
    if (ruleSet === undefined) {
      throw new ProductOwnerPromptAssetsError('Um rule set obrigatório não foi carregado.');
    }
    assertReference(reference, ruleSet, expectedFilenames[index]!);
    assertEqual(
      reference.scope,
      ruleSet.scope,
      'O scope do rule set não corresponde ao manifesto.',
    );
  });

  assertEqual(ruleSets[0]?.scope, 'GLOBAL', 'O primeiro rule set deve possuir scope GLOBAL.');
  assertEqual(ruleSets[0]?.agent, null, 'O rule set GLOBAL não pode declarar agente.');
  assertEqual(ruleSets[1]?.scope, 'SECURITY', 'O segundo rule set deve possuir scope SECURITY.');
  assertEqual(ruleSets[1]?.agent, null, 'O rule set SECURITY não pode declarar agente.');
  assertEqual(ruleSets[2]?.scope, 'AGENT', 'O terceiro rule set deve possuir scope AGENT.');
  assertEqual(
    ruleSets[2]?.agent,
    PRODUCT_OWNER_AGENT,
    'O rule set específico deve pertencer ao Product Owner.',
  );
}

function assertTemplateWiring(
  manifest: ProductOwnerPromptAssetManifest,
  template: PromptTemplate,
  ruleSets: readonly PromptRuleSet[],
): void {
  const fragments = template.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.fragments),
  );
  const ruleSetIds = fragments.flatMap((fragment) =>
    fragment.type === 'RULE_SET_SLOT' ? [fragment.ruleSetId] : [],
  );
  const contextIds = fragments.flatMap((fragment) =>
    fragment.type === 'CONTEXT_SLOT' ? [fragment.contextId] : [],
  );

  assertEqual(template.agent, PRODUCT_OWNER_AGENT, 'O template deve pertencer ao Product Owner.');
  assertArrayEqual(
    ruleSetIds,
    ruleSets.map((ruleSet) => ruleSet.id),
    'Os slots de rule sets não correspondem aos assets carregados.',
  );
  assertArrayEqual(
    contextIds,
    [manifest.contexts.knowledge, manifest.contexts.request],
    'Os slots de contexto não correspondem ao manifesto.',
  );
}

function parseJsonOutputContract(
  input: unknown,
): Extract<PromptOutputContract, { readonly format: 'JSON_SCHEMA' }> {
  const outputContract = promptOutputContractSchema.safeParse(input);
  if (!outputContract.success || outputContract.data.format !== 'JSON_SCHEMA') {
    throw new ProductOwnerPromptAssetsError(
      'O contrato de saída do Product Owner deve usar JSON_SCHEMA.',
      { cause: outputContract.success ? undefined : outputContract.error },
    );
  }
  return outputContract.data;
}

function deriveValidationContract(
  outputContract: Extract<PromptOutputContract, { readonly format: 'JSON_SCHEMA' }>,
  outputContractHash: string,
): Extract<ValidationContract, { readonly format: 'JSON_SCHEMA' }> {
  const result = validationContractSchema.safeParse({
    id: outputContract.id,
    version: outputContract.version,
    expectedOutputContractHash: outputContractHash,
    format: 'JSON_SCHEMA',
    dialect: 'DRAFT_2020_12',
    schema: outputContract.schema,
  });

  if (!result.success || result.data.format !== 'JSON_SCHEMA') {
    throw new ProductOwnerPromptAssetsError('Contrato de validação derivado inválido.', {
      cause: result.success ? undefined : result.error,
    });
  }
  return result.data;
}

function assertArtifactSpecification(
  specification: ArtifactSpecification,
  manifest: ProductOwnerPromptAssetManifest,
  validationContract: ValidationContract,
  validationContractHash: string,
): void {
  assertReference(
    manifest.assets.artifactSpecification,
    specification,
    PRODUCT_OWNER_ASSET_FILENAMES.artifactSpecification,
  );
  assertEqual(
    specification.sourceContract.id,
    validationContract.id,
    'A specification referencia outro contrato de validação.',
  );
  assertEqual(
    specification.sourceContract.version,
    validationContract.version,
    'A specification referencia outra versão do contrato de validação.',
  );
  assertEqual(
    specification.sourceContract.format,
    validationContract.format,
    'A specification referencia outro formato de validação.',
  );
  assertEqual(
    specification.sourceContract.contractHash,
    validationContractHash,
    'A specification não corresponde ao hash do contrato de validação.',
  );
  assertArrayEqual(
    specification.templates.map((template) => template.filename),
    PRODUCT_OWNER_ARTIFACT_FILENAMES,
    'A specification deve produzir somente os três artifacts canônicos do Product Owner.',
  );

  const expectedTemplates = [
    {
      id: 'artifact:product-owner-story',
      name: 'Product Owner Story',
      filename: 'story.md',
      type: 'PRODUCT_OWNER_STORY',
      format: 'TEXT',
      mediaType: 'text/markdown',
    },
    {
      id: 'artifact:product-owner-acceptance',
      name: 'Product Owner Acceptance',
      filename: 'acceptance.md',
      type: 'PRODUCT_OWNER_ACCEPTANCE',
      format: 'TEXT',
      mediaType: 'text/markdown',
    },
    {
      id: 'artifact:product-owner-backlog',
      name: 'Product Owner Backlog',
      filename: 'backlog.json',
      type: 'PRODUCT_OWNER_BACKLOG',
      format: 'JSON',
      mediaType: 'application/json',
    },
  ] as const;

  specification.templates.forEach((template, index) => {
    const expected = expectedTemplates[index];
    if (expected === undefined) return;

    for (const field of ['id', 'name', 'filename', 'type', 'format', 'mediaType'] as const) {
      assertEqual(
        template[field],
        expected[field],
        'A identidade de um template de artifact não corresponde ao release 1.0.1.',
      );
    }
  });
}

export function parseProductOwnerPromptAssets(
  sources: ProductOwnerPromptAssetSources,
): ProductOwnerPromptAssets {
  try {
    const manifest = parseManifest(sources.manifest);
    assertEqual(manifest.id, 'assets:product-owner', 'O ID do manifesto é inválido.');
    assertEqual(manifest.version, '1.0.1', 'A versão do bundle é inválida.');
    assertEqual(manifest.schemaVersion, '1.0.0', 'A versão do schema do manifesto é inválida.');

    const template = promptTemplateSchema.parse(sources.template) as PromptTemplate;
    const ruleSets = [
      promptRuleSetSchema.parse(sources.globalRules),
      promptRuleSetSchema.parse(sources.securityRules),
      promptRuleSetSchema.parse(sources.productOwnerRules),
    ] as readonly PromptRuleSet[];
    const outputContract = parseJsonOutputContract(sources.outputContract);
    const artifactSpecification = artifactSpecificationSchema.parse(
      sources.artifactSpecification,
    ) as ArtifactSpecification;

    assertReference(manifest.assets.template, template, PRODUCT_OWNER_ASSET_FILENAMES.template);
    assertRuleSetReferences(manifest, ruleSets);
    assertTemplateWiring(manifest, template, ruleSets);
    assertReference(
      manifest.assets.outputContract,
      outputContract,
      PRODUCT_OWNER_ASSET_FILENAMES.outputContract,
    );

    const manifestHash = calculateCanonicalJsonHash(asJsonValue(manifest));
    const templateHash = calculateCanonicalJsonHash(asJsonValue(template));
    const ruleSetHashes = ruleSets.map((ruleSet) => ({
      ruleSetId: ruleSet.id,
      hash: calculateCanonicalJsonHash(asJsonValue(ruleSet)),
    }));
    const outputContractHash = calculateCanonicalJsonHash(asJsonValue(outputContract));
    const validationContract = deriveValidationContract(outputContract, outputContractHash);
    const validationContractHash = calculateCanonicalJsonHash(asJsonValue(validationContract));
    assertArtifactSpecification(
      artifactSpecification,
      manifest,
      validationContract,
      validationContractHash,
    );
    const artifactSpecificationHash = calculateCanonicalJsonHash(
      asJsonValue(artifactSpecification),
    );
    const bundleHash = calculateCanonicalJsonHash({
      manifest: { id: manifest.id, version: manifest.version, hash: manifestHash },
      assets: [
        { kind: 'TEMPLATE', id: template.id, version: template.version, hash: templateHash },
        ...ruleSets.map((ruleSet, index) => ({
          kind: 'RULE_SET',
          id: ruleSet.id,
          version: ruleSet.version,
          hash: ruleSetHashes[index]!.hash,
        })),
        {
          kind: 'OUTPUT_CONTRACT',
          id: outputContract.id,
          version: outputContract.version,
          hash: outputContractHash,
        },
        {
          kind: 'VALIDATION_CONTRACT',
          id: validationContract.id,
          version: validationContract.version,
          hash: validationContractHash,
        },
        {
          kind: 'ARTIFACT_SPECIFICATION',
          id: artifactSpecification.id,
          version: artifactSpecification.version,
          hash: artifactSpecificationHash,
        },
      ],
    });
    assertEqual(
      bundleHash,
      PRODUCT_OWNER_RELEASE_1_0_1_BUNDLE_HASH,
      'O conteúdo do bundle não corresponde ao release Product Owner 1.0.1.',
    );

    return deepFreeze({
      manifest,
      template,
      ruleSets,
      outputContract,
      validationContract,
      artifactSpecification,
      hashes: {
        manifestHash,
        templateHash,
        ruleSetHashes,
        outputContractHash,
        validationContractHash,
        artifactSpecificationHash,
        bundleHash,
      },
    });
  } catch (error) {
    if (error instanceof ProductOwnerPromptAssetsError) throw error;
    throw new ProductOwnerPromptAssetsError('Assets do Product Owner inválidos.', { cause: error });
  }
}

export function validateProductOwnerPromptAssets(input: unknown): ProductOwnerPromptAssets {
  const candidate = productOwnerPromptAssetsSchema.safeParse(input);
  if (!candidate.success) {
    throw new ProductOwnerPromptAssetsError('Bundle de assets do Product Owner inválido.', {
      cause: candidate.error,
    });
  }

  const [globalRules, securityRules, productOwnerRules] = candidate.data.ruleSets;
  const recalculated = parseProductOwnerPromptAssets({
    manifest: candidate.data.manifest,
    template: candidate.data.template,
    globalRules,
    securityRules,
    productOwnerRules,
    outputContract: candidate.data.outputContract,
    artifactSpecification: candidate.data.artifactSpecification,
  });

  assertEqual(
    calculateCanonicalJsonHash(asJsonValue(candidate.data.validationContract)),
    recalculated.hashes.validationContractHash,
    'O contrato de validação injetado não corresponde ao contrato derivado.',
  );
  assertEqual(
    calculateCanonicalJsonHash(asJsonValue(candidate.data.hashes)),
    calculateCanonicalJsonHash(asJsonValue(recalculated.hashes)),
    'Os hashes injetados não correspondem aos assets do bundle.',
  );

  return recalculated;
}

let bundledProductOwnerPromptAssets: ProductOwnerPromptAssets | undefined;

export function loadProductOwnerPromptAssets(): ProductOwnerPromptAssets {
  bundledProductOwnerPromptAssets ??= validateProductOwnerPromptAssets(
    parseProductOwnerPromptAssets({
      manifest: rawManifest,
      template: rawTemplate,
      globalRules: rawGlobalRules,
      securityRules: rawSecurityRules,
      productOwnerRules: rawProductOwnerRules,
      outputContract: rawOutputContract,
      artifactSpecification: rawArtifactSpecification,
    }),
  );
  return bundledProductOwnerPromptAssets;
}
