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

import rawArtifactSpecification from '../../prompts/qa/1.0.0/artifact-specification.json' with { type: 'json' };
import rawQARules from '../../prompts/qa/1.0.0/qa-rules.json' with { type: 'json' };
import rawGlobalRules from '../../prompts/qa/1.0.0/global-rules.json' with { type: 'json' };
import rawManifest from '../../prompts/qa/1.0.0/manifest.json' with { type: 'json' };
import rawOutputContract from '../../prompts/qa/1.0.0/output-contract.json' with { type: 'json' };
import rawSecurityRules from '../../prompts/qa/1.0.0/security-rules.json' with { type: 'json' };
import rawTemplate from '../../prompts/qa/1.0.0/template.json' with { type: 'json' };
import { deepFreeze } from './immutability';

const QA_AGENT = 'QA' as const;
const QA_ASSET_FILENAMES = {
  template: 'template.json',
  globalRules: 'global-rules.json',
  securityRules: 'security-rules.json',
  qaRules: 'qa-rules.json',
  outputContract: 'output-contract.json',
  artifactSpecification: 'artifact-specification.json',
} as const;
const QA_ARTIFACT_IDENTITIES = [
  {
    id: 'artifact:qa-test-plan',
    name: 'QA Test Plan',
    filename: 'test-plan.md',
    type: 'QA_TEST_PLAN',
    format: 'TEXT',
    mediaType: 'text/markdown',
  },
  {
    id: 'artifact:qa-traceability-matrix',
    name: 'QA Traceability Matrix',
    filename: 'traceability-matrix.json',
    type: 'QA_TRACEABILITY_MATRIX',
    format: 'JSON',
    mediaType: 'application/json',
  },
  {
    id: 'artifact:qa-specification',
    name: 'QA Specification',
    filename: 'qa-specification.md',
    type: 'QA_SPECIFICATION',
    format: 'TEXT',
    mediaType: 'text/markdown',
  },
] as const;
const QA_RELEASE_1_0_0_BUNDLE_HASH =
  'c674db967cd7af9c8e2471fc1b546edbc5ea3133e0c846171e943bc48fdff693';
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

export const qaPromptAssetManifestSchema = z
  .object({
    id: promptNodeIdSchema,
    version: semanticVersionSchema,
    schemaVersion: semanticVersionSchema,
    agent: z.literal(QA_AGENT),
    contexts: z
      .object({
        knowledge: promptNodeIdSchema,
        productOwnerSpecification: promptNodeIdSchema,
        technicalSpecification: promptNodeIdSchema,
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

    const contextIds = Object.values(manifest.contexts);
    if (new Set(contextIds).size !== contextIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Os três contextos do QA devem possuir IDs distintos.',
        path: ['contexts'],
      });
    }
  });

export type QAPromptAssetManifest = Readonly<z.infer<typeof qaPromptAssetManifestSchema>>;

export interface QAPromptAssetSources {
  readonly manifest: unknown;
  readonly template: unknown;
  readonly globalRules: unknown;
  readonly securityRules: unknown;
  readonly qaRules: unknown;
  readonly outputContract: unknown;
  readonly artifactSpecification: unknown;
}

export interface QARuleSetHash {
  readonly ruleSetId: string;
  readonly hash: string;
}

export interface QAPromptAssetHashes {
  readonly manifestHash: string;
  readonly templateHash: string;
  readonly ruleSetHashes: readonly QARuleSetHash[];
  readonly outputContractHash: string;
  readonly validationContractHash: string;
  readonly artifactSpecificationHash: string;
  readonly bundleHash: string;
}

export interface QAPromptAssets {
  readonly manifest: QAPromptAssetManifest;
  readonly template: PromptTemplate;
  readonly ruleSets: readonly PromptRuleSet[];
  readonly outputContract: Extract<PromptOutputContract, { readonly format: 'JSON_SCHEMA' }>;
  readonly validationContract: Extract<ValidationContract, { readonly format: 'JSON_SCHEMA' }>;
  readonly artifactSpecification: ArtifactSpecification;
  readonly hashes: QAPromptAssetHashes;
}

const qaPromptAssetHashesSchema = z
  .object({
    manifestHash: hashSchema,
    templateHash: hashSchema,
    ruleSetHashes: z
      .array(z.object({ ruleSetId: promptNodeIdSchema, hash: hashSchema }).strict())
      .length(3),
    outputContractHash: hashSchema,
    validationContractHash: hashSchema,
    artifactSpecificationHash: hashSchema,
    bundleHash: hashSchema,
  })
  .strict();

const qaPromptAssetsSchema = z
  .object({
    manifest: qaPromptAssetManifestSchema,
    template: promptTemplateSchema,
    ruleSets: z.array(promptRuleSetSchema).length(3),
    outputContract: promptOutputContractSchema,
    validationContract: validationContractSchema,
    artifactSpecification: artifactSpecificationSchema,
    hashes: qaPromptAssetHashesSchema,
  })
  .strict();

export const QA_PROMPT_ASSET_ERROR_CODE = 'QA_PROMPT_ASSETS_INVALID';

export class QAPromptAssetsError extends Error {
  readonly code = QA_PROMPT_ASSET_ERROR_CODE;

  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'QAPromptAssetsError';
  }
}

function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new QAPromptAssetsError(message);
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
    throw new QAPromptAssetsError(message);
  }
}

function parseManifest(input: unknown): QAPromptAssetManifest {
  const result = qaPromptAssetManifestSchema.safeParse(input);
  if (!result.success) {
    throw new QAPromptAssetsError('Manifesto de assets do QA inválido.', {
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
  manifest: QAPromptAssetManifest,
  ruleSets: readonly PromptRuleSet[],
): void {
  const expectedFilenames = [
    QA_ASSET_FILENAMES.globalRules,
    QA_ASSET_FILENAMES.securityRules,
    QA_ASSET_FILENAMES.qaRules,
  ];

  manifest.assets.ruleSets.forEach((reference, index) => {
    const ruleSet = ruleSets[index];
    if (ruleSet === undefined) {
      throw new QAPromptAssetsError('Um rule set obrigatório não foi carregado.');
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
  assertEqual(ruleSets[2]?.agent, QA_AGENT, 'O rule set específico deve pertencer ao QA.');
}

function assertTemplateWiring(
  manifest: QAPromptAssetManifest,
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

  assertEqual(template.agent, QA_AGENT, 'O template deve pertencer ao QA.');
  assertArrayEqual(
    ruleSetIds,
    ruleSets.map((ruleSet) => ruleSet.id),
    'Os slots de rule sets não correspondem aos assets carregados.',
  );
  assertArrayEqual(
    contextIds,
    [
      manifest.contexts.knowledge,
      manifest.contexts.productOwnerSpecification,
      manifest.contexts.technicalSpecification,
    ],
    'Os slots de contexto não correspondem ao manifesto.',
  );
}

function parseJsonOutputContract(
  input: unknown,
): Extract<PromptOutputContract, { readonly format: 'JSON_SCHEMA' }> {
  const outputContract = promptOutputContractSchema.safeParse(input);
  if (!outputContract.success || outputContract.data.format !== 'JSON_SCHEMA') {
    throw new QAPromptAssetsError('O contrato de saída do QA deve usar JSON_SCHEMA.', {
      cause: outputContract.success ? undefined : outputContract.error,
    });
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
    throw new QAPromptAssetsError('Contrato de validação derivado inválido.', {
      cause: result.success ? undefined : result.error,
    });
  }
  return result.data;
}

function assertArtifactSpecification(
  specification: ArtifactSpecification,
  manifest: QAPromptAssetManifest,
  validationContract: ValidationContract,
  validationContractHash: string,
): void {
  assertReference(
    manifest.assets.artifactSpecification,
    specification,
    QA_ASSET_FILENAMES.artifactSpecification,
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
    QA_ARTIFACT_IDENTITIES.map((identity) => identity.filename),
    'A specification deve produzir somente os três artifacts canônicos do QA.',
  );

  specification.templates.forEach((template, index) => {
    const expected = QA_ARTIFACT_IDENTITIES[index];
    if (expected === undefined) return;
    for (const field of ['id', 'name', 'filename', 'type', 'format', 'mediaType'] as const) {
      assertEqual(
        template[field],
        expected[field],
        'A identidade de um template de artifact não corresponde ao release 1.0.0.',
      );
    }
  });
}

export function parseQAPromptAssets(sources: QAPromptAssetSources): QAPromptAssets {
  try {
    const manifest = parseManifest(sources.manifest);
    assertEqual(manifest.id, 'assets:qa', 'O ID do manifesto é inválido.');
    assertEqual(manifest.version, '1.0.0', 'A versão do bundle é inválida.');
    assertEqual(manifest.schemaVersion, '1.0.0', 'A versão do schema do manifesto é inválida.');

    const template = promptTemplateSchema.parse(sources.template) as PromptTemplate;
    const ruleSets = [
      promptRuleSetSchema.parse(sources.globalRules),
      promptRuleSetSchema.parse(sources.securityRules),
      promptRuleSetSchema.parse(sources.qaRules),
    ] as readonly PromptRuleSet[];
    const outputContract = parseJsonOutputContract(sources.outputContract);
    const artifactSpecification = artifactSpecificationSchema.parse(
      sources.artifactSpecification,
    ) as ArtifactSpecification;

    assertReference(manifest.assets.template, template, QA_ASSET_FILENAMES.template);
    assertRuleSetReferences(manifest, ruleSets);
    assertTemplateWiring(manifest, template, ruleSets);
    assertReference(
      manifest.assets.outputContract,
      outputContract,
      QA_ASSET_FILENAMES.outputContract,
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
      QA_RELEASE_1_0_0_BUNDLE_HASH,
      'O conteúdo do bundle não corresponde ao release QA 1.0.0.',
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
    if (error instanceof QAPromptAssetsError) throw error;
    throw new QAPromptAssetsError('Assets do QA inválidos.', { cause: error });
  }
}

export function validateQAPromptAssets(input: unknown): QAPromptAssets {
  const candidate = qaPromptAssetsSchema.safeParse(input);
  if (!candidate.success) {
    throw new QAPromptAssetsError('Bundle de assets do QA inválido.', {
      cause: candidate.error,
    });
  }

  const [globalRules, securityRules, qaRules] = candidate.data.ruleSets;
  const recalculated = parseQAPromptAssets({
    manifest: candidate.data.manifest,
    template: candidate.data.template,
    globalRules,
    securityRules,
    qaRules,
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

let bundledQAPromptAssets: QAPromptAssets | undefined;

export function loadQAPromptAssets(): QAPromptAssets {
  bundledQAPromptAssets ??= validateQAPromptAssets(
    parseQAPromptAssets({
      manifest: rawManifest,
      template: rawTemplate,
      globalRules: rawGlobalRules,
      securityRules: rawSecurityRules,
      qaRules: rawQARules,
      outputContract: rawOutputContract,
      artifactSpecification: rawArtifactSpecification,
    }),
  );
  return bundledQAPromptAssets;
}
