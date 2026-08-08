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

import rawCodeGeneratorRules from '../../prompts/code-generator/1.0.0/code-generator-rules.json' with { type: 'json' };
import rawGlobalRules from '../../prompts/code-generator/1.0.0/global-rules.json' with { type: 'json' };
import rawManifest from '../../prompts/code-generator/1.0.0/manifest.json' with { type: 'json' };
import rawOutputContract from '../../prompts/code-generator/1.0.0/output-contract.json' with { type: 'json' };
import rawSecurityRules from '../../prompts/code-generator/1.0.0/security-rules.json' with { type: 'json' };
import rawTemplate from '../../prompts/code-generator/1.0.0/template.json' with { type: 'json' };
import { calculateCodeGeneratorAssetBundleHash } from './asset-hashing';
import { deepFreeze } from './immutability';

const CODE_GENERATOR_AGENT = 'CODE_GENERATOR' as const;
const CODE_GENERATOR_ASSET_FILENAMES = {
  template: 'template.json',
  globalRules: 'global-rules.json',
  securityRules: 'security-rules.json',
  codeGeneratorRules: 'code-generator-rules.json',
  outputContract: 'output-contract.json',
} as const;
const CODE_GENERATOR_RELEASE_1_0_0_BUNDLE_HASH =
  'df968b649b607d7bd7c34ad05f4e7f2d1bb22880aab8582250ecffc443c88504';
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const assetFilenameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((filename) => filename === filename.trim())
  .pipe(safeFilenameSchema)
  .refine((filename) => filename.endsWith('.json'));
const assetReferenceBase = {
  filename: assetFilenameSchema,
  id: promptNodeIdSchema,
  version: semanticVersionSchema,
};
const promptAssetReferenceSchema = z.object(assetReferenceBase).strict();
const ruleSetAssetReferenceSchema = z
  .object({ ...assetReferenceBase, scope: z.enum(['GLOBAL', 'SECURITY', 'AGENT']) })
  .strict();

export const codeGeneratorPromptAssetManifestSchema = z
  .object({
    id: promptNodeIdSchema,
    version: semanticVersionSchema,
    schemaVersion: semanticVersionSchema,
    agent: z.literal(CODE_GENERATOR_AGENT),
    contexts: z
      .object({
        knowledge: promptNodeIdSchema,
        technicalSpecification: promptNodeIdSchema,
      })
      .strict(),
    assets: z
      .object({
        template: promptAssetReferenceSchema,
        ruleSets: z.array(ruleSetAssetReferenceSchema).length(3),
        outputContract: promptAssetReferenceSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const references = [
      manifest.assets.template,
      ...manifest.assets.ruleSets,
      manifest.assets.outputContract,
    ];
    const identifiers = new Set<string>();
    const filenames = new Set<string>();
    references.forEach((reference, index) => {
      if (identifiers.has(reference.id)) {
        context.addIssue({
          code: 'custom',
          path: ['assets', index, 'id'],
          message: 'Os IDs dos assets devem ser únicos.',
        });
      }
      if (filenames.has(reference.filename)) {
        context.addIssue({
          code: 'custom',
          path: ['assets', index, 'filename'],
          message: 'Os filenames dos assets devem ser únicos.',
        });
      }
      identifiers.add(reference.id);
      filenames.add(reference.filename);
    });
    if (manifest.contexts.knowledge === manifest.contexts.technicalSpecification) {
      context.addIssue({
        code: 'custom',
        path: ['contexts'],
        message: 'Os contextos devem possuir IDs distintos.',
      });
    }
  });

export type CodeGeneratorPromptAssetManifest = Readonly<
  z.infer<typeof codeGeneratorPromptAssetManifestSchema>
>;

export interface CodeGeneratorPromptAssetSources {
  readonly manifest: unknown;
  readonly template: unknown;
  readonly globalRules: unknown;
  readonly securityRules: unknown;
  readonly codeGeneratorRules: unknown;
  readonly outputContract: unknown;
}

export interface CodeGeneratorRuleSetHash {
  readonly ruleSetId: string;
  readonly hash: string;
}

export interface CodeGeneratorPromptAssetHashes {
  readonly manifestHash: string;
  readonly templateHash: string;
  readonly ruleSetHashes: readonly CodeGeneratorRuleSetHash[];
  readonly outputContractHash: string;
  readonly validationContractHash: string;
  readonly bundleHash: string;
}

export interface CodeGeneratorPromptAssets {
  readonly manifest: CodeGeneratorPromptAssetManifest;
  readonly template: PromptTemplate;
  readonly ruleSets: readonly PromptRuleSet[];
  readonly outputContract: Extract<PromptOutputContract, { readonly format: 'JSON_SCHEMA' }>;
  readonly validationContract: Extract<ValidationContract, { readonly format: 'JSON_SCHEMA' }>;
  readonly hashes: CodeGeneratorPromptAssetHashes;
}

const codeGeneratorPromptAssetHashesSchema = z
  .object({
    manifestHash: hashSchema,
    templateHash: hashSchema,
    ruleSetHashes: z
      .array(z.object({ ruleSetId: promptNodeIdSchema, hash: hashSchema }).strict())
      .length(3),
    outputContractHash: hashSchema,
    validationContractHash: hashSchema,
    bundleHash: hashSchema,
  })
  .strict();
const codeGeneratorPromptAssetsSchema = z
  .object({
    manifest: codeGeneratorPromptAssetManifestSchema,
    template: promptTemplateSchema,
    ruleSets: z.array(promptRuleSetSchema).length(3),
    outputContract: promptOutputContractSchema,
    validationContract: validationContractSchema,
    hashes: codeGeneratorPromptAssetHashesSchema,
  })
  .strict();

export const CODE_GENERATOR_PROMPT_ASSET_ERROR_CODE = 'CODE_GENERATOR_PROMPT_ASSETS_INVALID';

export class CodeGeneratorPromptAssetsError extends Error {
  readonly code = CODE_GENERATOR_PROMPT_ASSET_ERROR_CODE;

  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'CodeGeneratorPromptAssetsError';
  }
}

function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new CodeGeneratorPromptAssetsError(message);
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
    throw new CodeGeneratorPromptAssetsError(message);
  }
}

function parseManifest(input: unknown): CodeGeneratorPromptAssetManifest {
  const result = codeGeneratorPromptAssetManifestSchema.safeParse(input);
  if (!result.success) {
    throw new CodeGeneratorPromptAssetsError('Manifesto de assets do Code Generator inválido.', {
      cause: result.error,
    });
  }
  return result.data;
}

function assertReference(
  reference: z.infer<typeof promptAssetReferenceSchema>,
  asset: { readonly id: string; readonly version: string },
  filename: string,
): void {
  assertEqual(reference.filename, filename, 'O manifesto referencia um filename inválido.');
  assertEqual(reference.id, asset.id, 'O ID do asset não corresponde ao manifesto.');
  assertEqual(reference.version, asset.version, 'A versão do asset não corresponde ao manifesto.');
}

function assertRuleSets(
  manifest: CodeGeneratorPromptAssetManifest,
  ruleSets: readonly PromptRuleSet[],
): void {
  const filenames = [
    CODE_GENERATOR_ASSET_FILENAMES.globalRules,
    CODE_GENERATOR_ASSET_FILENAMES.securityRules,
    CODE_GENERATOR_ASSET_FILENAMES.codeGeneratorRules,
  ];
  manifest.assets.ruleSets.forEach((reference, index) => {
    const ruleSet = ruleSets[index];
    if (ruleSet === undefined) {
      throw new CodeGeneratorPromptAssetsError('Um rule set obrigatório não foi carregado.');
    }
    assertReference(reference, ruleSet, filenames[index]!);
    assertEqual(reference.scope, ruleSet.scope, 'O scope do rule set não corresponde.');
  });
  assertEqual(ruleSets[0]?.scope, 'GLOBAL', 'O primeiro rule set deve ser GLOBAL.');
  assertEqual(ruleSets[0]?.agent, null, 'O rule set GLOBAL não declara agente.');
  assertEqual(ruleSets[1]?.scope, 'SECURITY', 'O segundo rule set deve ser SECURITY.');
  assertEqual(ruleSets[1]?.agent, null, 'O rule set SECURITY não declara agente.');
  assertEqual(ruleSets[2]?.scope, 'AGENT', 'O terceiro rule set deve ser AGENT.');
  assertEqual(ruleSets[2]?.agent, CODE_GENERATOR_AGENT, 'O rule set deve pertencer ao agente.');
}

function assertTemplateWiring(
  manifest: CodeGeneratorPromptAssetManifest,
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
  assertEqual(template.agent, CODE_GENERATOR_AGENT, 'O template pertence a outro agente.');
  assertArrayEqual(
    ruleSetIds,
    ruleSets.map((ruleSet) => ruleSet.id),
    'Os slots de regras não correspondem ao bundle.',
  );
  assertArrayEqual(
    contextIds,
    [manifest.contexts.knowledge, manifest.contexts.technicalSpecification],
    'Os slots de contexto não correspondem ao manifesto.',
  );
}

function parseOutputContract(
  input: unknown,
): Extract<PromptOutputContract, { readonly format: 'JSON_SCHEMA' }> {
  const result = promptOutputContractSchema.safeParse(input);
  if (!result.success || result.data.format !== 'JSON_SCHEMA') {
    throw new CodeGeneratorPromptAssetsError('O contrato deve usar JSON_SCHEMA.', {
      cause: result.success ? undefined : result.error,
    });
  }
  return result.data;
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
    throw new CodeGeneratorPromptAssetsError('Contrato de validação derivado inválido.', {
      cause: result.success ? undefined : result.error,
    });
  }
  return result.data;
}

export function parseCodeGeneratorPromptAssets(
  sources: CodeGeneratorPromptAssetSources,
): CodeGeneratorPromptAssets {
  try {
    const manifest = parseManifest(sources.manifest);
    assertEqual(manifest.id, 'assets:code-generator', 'O ID do manifesto é inválido.');
    assertEqual(manifest.version, '1.0.0', 'A versão do bundle é inválida.');
    assertEqual(manifest.schemaVersion, '1.0.0', 'A versão do schema é inválida.');

    const template = promptTemplateSchema.parse(sources.template) as PromptTemplate;
    const ruleSets = [
      promptRuleSetSchema.parse(sources.globalRules),
      promptRuleSetSchema.parse(sources.securityRules),
      promptRuleSetSchema.parse(sources.codeGeneratorRules),
    ] as readonly PromptRuleSet[];
    const outputContract = parseOutputContract(sources.outputContract);

    assertReference(manifest.assets.template, template, CODE_GENERATOR_ASSET_FILENAMES.template);
    assertRuleSets(manifest, ruleSets);
    assertTemplateWiring(manifest, template, ruleSets);
    assertReference(
      manifest.assets.outputContract,
      outputContract,
      CODE_GENERATOR_ASSET_FILENAMES.outputContract,
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
    const bundleHash = calculateCodeGeneratorAssetBundleHash({
      manifest: { id: manifest.id, version: manifest.version, hash: manifestHash },
      template: { id: template.id, version: template.version, hash: templateHash },
      ruleSets: ruleSets.map((ruleSet, index) => ({
        id: ruleSet.id,
        version: ruleSet.version,
        hash: ruleSetHashes[index]!.hash,
      })),
      outputContract: {
        id: outputContract.id,
        version: outputContract.version,
        hash: outputContractHash,
      },
      validationContract: {
        id: validationContract.id,
        version: validationContract.version,
        hash: validationContractHash,
      },
    });
    assertEqual(
      bundleHash,
      CODE_GENERATOR_RELEASE_1_0_0_BUNDLE_HASH,
      'O conteúdo não corresponde ao release Code Generator 1.0.0.',
    );

    return deepFreeze({
      manifest,
      template,
      ruleSets,
      outputContract,
      validationContract,
      hashes: {
        manifestHash,
        templateHash,
        ruleSetHashes,
        outputContractHash,
        validationContractHash,
        bundleHash,
      },
    });
  } catch (error) {
    if (error instanceof CodeGeneratorPromptAssetsError) throw error;
    throw new CodeGeneratorPromptAssetsError('Assets do Code Generator inválidos.', {
      cause: error,
    });
  }
}

export function validateCodeGeneratorPromptAssets(input: unknown): CodeGeneratorPromptAssets {
  const candidate = codeGeneratorPromptAssetsSchema.safeParse(input);
  if (!candidate.success) {
    throw new CodeGeneratorPromptAssetsError('Bundle de assets do Code Generator inválido.', {
      cause: candidate.error,
    });
  }
  const [globalRules, securityRules, codeGeneratorRules] = candidate.data.ruleSets;
  const recalculated = parseCodeGeneratorPromptAssets({
    manifest: candidate.data.manifest,
    template: candidate.data.template,
    globalRules,
    securityRules,
    codeGeneratorRules,
    outputContract: candidate.data.outputContract,
  });
  assertEqual(
    calculateCanonicalJsonHash(asJsonValue(candidate.data.validationContract)),
    recalculated.hashes.validationContractHash,
    'O contrato de validação injetado não corresponde ao derivado.',
  );
  assertEqual(
    calculateCanonicalJsonHash(asJsonValue(candidate.data.hashes)),
    calculateCanonicalJsonHash(asJsonValue(recalculated.hashes)),
    'Os hashes injetados não correspondem aos assets.',
  );
  return recalculated;
}

let bundledCodeGeneratorPromptAssets: CodeGeneratorPromptAssets | undefined;

export function loadCodeGeneratorPromptAssets(): CodeGeneratorPromptAssets {
  bundledCodeGeneratorPromptAssets ??= validateCodeGeneratorPromptAssets(
    parseCodeGeneratorPromptAssets({
      manifest: rawManifest,
      template: rawTemplate,
      globalRules: rawGlobalRules,
      securityRules: rawSecurityRules,
      codeGeneratorRules: rawCodeGeneratorRules,
      outputContract: rawOutputContract,
    }),
  );
  return bundledCodeGeneratorPromptAssets;
}
