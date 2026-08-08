import { Buffer } from 'node:buffer';

import {
  agentRunMetricsSchema,
  agentRunOutputSchema,
  promptMetadataSchema,
  providerMetadataSchema,
} from '@brq/agent-runner';
import { technicalSpecificationSchema } from '@brq/developer-agent';
import {
  knowledgeCategorySchema,
  knowledgeContextBudgetSchema,
  knowledgeDocumentIdSchema,
  knowledgeHashSchema,
  knowledgeSourceIdSchema,
} from '@brq/knowledge-loader';
import { canonicalizeJson } from '@brq/prompt-builder';
import { validationIssueSchema, validationMetadataSchema } from '@brq/response-validator';
import { identifierSchema, semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

import { calculateCodeGeneratorAssetBundleHash } from './asset-hashing';
import {
  CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES,
  CODE_GENERATOR_BUSINESS_VALIDATION_MAX_ISSUES,
  validateCodeGenerationOutputSafety,
} from './business-validation';
import {
  calculateBundleContentHash,
  calculateCodeGenerationHash,
  calculateCodeGenerationLineageHash,
  calculateCodeGenerationProvenanceHash,
  calculateGeneratedBundleHash,
  calculateGeneratedContentHash,
  calculateGeneratedFileHash,
  calculateGeneratedManifestHash,
  compareCodeUnits,
  projectGeneratedManifestFile,
} from './hashing';
import {
  CODE_GENERATOR_CONTRACT_LIMITS,
  CODE_GENERATOR_CONTRACT_VERSION,
  CODE_GENERATOR_BUNDLE_VERSION,
  CODE_GENERATOR_FILE_PURPOSES,
  CODE_GENERATOR_MEDIA_TYPES,
} from './limits';

const { generation, request } = CODE_GENERATOR_CONTRACT_LIMITS;

function addMismatch(
  context: z.core.$RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  context.addIssue({ code: 'custom', path: [...path], message });
}

function canonicalValuesMatch(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left as never) === canonicalizeJson(right as never);
}

function isBinarySorted(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || compareCodeUnits(values[index - 1]!, value) <= 0,
  );
}

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const moduleReferenceSchema = z.string().regex(/^MOD-[0-9]{3}$/);
const planReferenceSchema = z.string().regex(/^PLAN-[0-9]{3}$/);

export const codeGeneratorAgentOutcomeSchema = z.enum(['GENERATED', 'VALIDATION_REJECTED']);
export const generatedCodeEncodingSchema = z.literal('UTF-8');
export const generatedCodeMediaTypeSchema = z.enum(CODE_GENERATOR_MEDIA_TYPES);
export const generatedCodeFilePurposeSchema = z.enum(CODE_GENERATOR_FILE_PURPOSES);

export const codeGeneratorAgentContextSchema = z
  .object({
    executionId: identifierSchema,
    agentExecutionId: identifierSchema,
    attempt: z.number().int().positive(),
    agentVersion: semanticVersionSchema,
    requestId: identifierSchema.optional(),
    traceId: identifierSchema.optional(),
  })
  .strict();

export const codeGenerationApprovalSchema = z
  .object({
    kind: z.literal('WORKFLOW_QA_READY'),
    executionId: identifierSchema,
    workflowId: identifierSchema,
    executionHash: hashSchema,
    workflowHash: hashSchema,
    lineageHash: hashSchema,
    provenanceHash: hashSchema,
    qaSpecificationHash: knowledgeHashSchema,
    qaReadiness: z.literal('READY'),
    technicalHandoffVerified: z.literal(true),
  })
  .strict();

export const codeGeneratorAgentLimitsSchema = z
  .object({
    knowledgeMaxDocuments: z.number().int().positive().max(request.knowledgeDocuments).optional(),
    knowledgeMaxBytes: z.number().int().positive().max(request.knowledgeBytes).optional(),
    promptMaxBytes: z.number().int().positive().max(request.promptBytes).optional(),
    maxOutputTokens: z.number().int().positive().max(request.maxOutputTokens).optional(),
    timeoutMs: z.number().int().min(1_000).max(request.timeoutMs).optional(),
  })
  .strict();

export const codeGenerationRequestSchema = z
  .object({
    context: codeGeneratorAgentContextSchema,
    technicalSpecification: technicalSpecificationSchema,
    declaredTechnicalSpecificationHash: knowledgeHashSchema,
    approval: codeGenerationApprovalSchema,
    model: z
      .string()
      .min(1)
      .max(request.modelCharacters)
      .refine((value) => value === value.trim() && value.trim().length > 0),
    limits: codeGeneratorAgentLimitsSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const sizeBytes = Buffer.byteLength(
      canonicalizeJson(value.technicalSpecification as never),
      'utf8',
    );
    if (sizeBytes > request.technicalSpecificationBytes) {
      addMismatch(
        context,
        ['technicalSpecification'],
        `TechnicalSpecification excede ${request.technicalSpecificationBytes} bytes.`,
      );
    }
  });

export const rawGeneratedCodeFileSchema = z
  .object({
    path: z.string().min(1).max(generation.pathCharacters),
    content: z.string().max(generation.fileBytes),
    encoding: generatedCodeEncodingSchema,
    mediaType: generatedCodeMediaTypeSchema,
    purpose: generatedCodeFilePurposeSchema,
    sourceModuleIds: z.array(moduleReferenceSchema).max(generation.referencesPerFile),
    sourcePlanItemIds: z.array(planReferenceSchema).max(generation.referencesPerFile),
  })
  .strict();

export const generatedCodeProposalSchema = z
  .object({
    files: z.array(rawGeneratedCodeFileSchema).max(generation.files),
    entrypoints: z
      .array(z.string().min(1).max(generation.pathCharacters))
      .min(1)
      .max(generation.entrypoints),
  })
  .strict();

export const codeGeneratorBusinessValidationIssueCodeSchema = z.enum(
  Object.values(CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES),
);

export const codeGeneratorBusinessValidationIssueSchema = z
  .object({
    code: codeGeneratorBusinessValidationIssueCodeSchema,
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])).max(32),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const codeGeneratorBusinessValidationResultSchema = z
  .object({
    valid: z.boolean(),
    issues: z
      .array(codeGeneratorBusinessValidationIssueSchema)
      .max(CODE_GENERATOR_BUSINESS_VALIDATION_MAX_ISSUES),
    issuesTruncated: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.valid !== (value.issues.length === 0)) {
      addMismatch(context, ['valid'], 'valid deve corresponder à ausência de issues de negócio.');
    }
    if (value.valid && value.issuesTruncated) {
      addMismatch(context, ['issuesTruncated'], 'Uma validação válida não pode truncar issues.');
    }
    if (
      value.issuesTruncated &&
      value.issues.length !== CODE_GENERATOR_BUSINESS_VALIDATION_MAX_ISSUES
    ) {
      addMismatch(
        context,
        ['issuesTruncated'],
        'issuesTruncated exige que o limite público tenha sido atingido.',
      );
    }
  });

export const generatedCodeFileSchema = rawGeneratedCodeFileSchema.extend({
  byteLength: z.number().int().nonnegative().max(generation.fileBytes),
  contentHash: hashSchema,
  fileHash: hashSchema,
});

export const generatedCodeManifestFileSchema = generatedCodeFileSchema.omit({ content: true });

export const generatedCodeManifestSchema = z
  .object({
    bundleVersion: z.literal(CODE_GENERATOR_BUNDLE_VERSION),
    contractVersion: z.literal(CODE_GENERATOR_CONTRACT_VERSION),
    fileCount: z.number().int().min(1).max(generation.files),
    totalBytes: z.number().int().positive().max(generation.bundleBytes),
    entrypoints: z
      .array(z.string().min(1).max(generation.pathCharacters))
      .min(1)
      .max(generation.entrypoints),
    files: z.array(generatedCodeManifestFileSchema).min(1).max(generation.files),
    bundleContentHash: hashSchema,
    manifestHash: hashSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.fileCount !== value.files.length) {
      addMismatch(context, ['fileCount'], 'fileCount deve corresponder aos arquivos do manifest.');
    }
    const totalBytes = value.files.reduce((total, file) => total + file.byteLength, 0);
    if (value.totalBytes !== totalBytes) {
      addMismatch(context, ['totalBytes'], 'totalBytes deve corresponder à soma dos arquivos.');
    }
  });

export const codeGenerationLineageSchema = z
  .object({
    technicalSpecificationHash: knowledgeHashSchema,
    declaredTechnicalSpecificationHash: knowledgeHashSchema,
    qaSpecificationHash: knowledgeHashSchema,
    technicalHandoffVerified: z.literal(true),
    files: z.array(
      z
        .object({
          path: z.string().min(1).max(generation.pathCharacters),
          fileHash: hashSchema,
          sourceModuleIds: z.array(moduleReferenceSchema).max(generation.referencesPerFile),
          sourcePlanItemIds: z.array(planReferenceSchema).max(generation.referencesPerFile),
        })
        .strict(),
    ),
  })
  .strict();

export const codeGenerationProvenanceSchema = z
  .object({
    agent: z.literal('CODE_GENERATOR'),
    agentVersion: semanticVersionSchema,
    approval: codeGenerationApprovalSchema,
    assetBundleHash: hashSchema,
    knowledgeContextHash: knowledgeHashSchema,
    promptHash: hashSchema,
    responseHash: hashSchema,
    validationHash: hashSchema,
    provider: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(request.modelCharacters),
  })
  .strict();

export const generatedCodeBundleHashesSchema = z
  .object({
    bundleContentHash: hashSchema,
    manifestHash: hashSchema,
    lineageHash: hashSchema,
    provenanceHash: hashSchema,
    bundleHash: hashSchema,
    generationHash: hashSchema,
  })
  .strict();

export const generatedCodeBundleSchema = z
  .object({
    bundleVersion: z.literal(CODE_GENERATOR_BUNDLE_VERSION),
    contractVersion: z.literal(CODE_GENERATOR_CONTRACT_VERSION),
    technicalSpecificationHash: knowledgeHashSchema,
    bundleContentHash: hashSchema,
    files: z.array(generatedCodeFileSchema).min(1).max(generation.files),
    entrypoints: z
      .array(z.string().min(1).max(generation.pathCharacters))
      .min(1)
      .max(generation.entrypoints),
    manifest: generatedCodeManifestSchema,
    lineage: codeGenerationLineageSchema,
    provenance: codeGenerationProvenanceSchema,
    hashes: generatedCodeBundleHashesSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const outputSafety = validateCodeGenerationOutputSafety(value);
    for (const issue of outputSafety.issues) {
      addMismatch(context, issue.path, `${issue.code}: ${issue.message}`);
    }
    if (outputSafety.issuesTruncated) {
      addMismatch(
        context,
        ['files'],
        'A validação de segurança do bundle excedeu o limite público de issues.',
      );
    }

    if (!isBinarySorted(value.files.map((file) => file.path))) {
      addMismatch(context, ['files'], 'Os arquivos devem usar ordenação binária determinística.');
    }
    if (!isBinarySorted(value.entrypoints)) {
      addMismatch(
        context,
        ['entrypoints'],
        'Os entrypoints devem usar ordenação binária determinística.',
      );
    }

    value.files.forEach((file, index) => {
      const expectedByteLength = Buffer.byteLength(file.content, 'utf8');
      const expectedContentHash = calculateGeneratedContentHash(file.content);
      const expectedFileHash = calculateGeneratedFileHash(file);
      if (file.byteLength !== expectedByteLength) {
        addMismatch(
          context,
          ['files', index, 'byteLength'],
          'byteLength deve corresponder ao conteúdo UTF-8.',
        );
      }
      if (file.contentHash !== expectedContentHash) {
        addMismatch(
          context,
          ['files', index, 'contentHash'],
          'contentHash deve corresponder ao conteúdo textual.',
        );
      }
      if (file.fileHash !== expectedFileHash) {
        addMismatch(
          context,
          ['files', index, 'fileHash'],
          'fileHash deve corresponder ao descritor e conteúdo do arquivo.',
        );
      }
    });

    const expectedBundleContentHash = calculateBundleContentHash(value.files);
    if (value.bundleContentHash !== expectedBundleContentHash) {
      addMismatch(
        context,
        ['bundleContentHash'],
        'bundleContentHash deve corresponder aos descritores ordenados dos arquivos.',
      );
    }

    const expectedManifestFiles = value.files.map(projectGeneratedManifestFile);
    const expectedManifestProjection = {
      bundleVersion: value.bundleVersion,
      contractVersion: value.contractVersion,
      fileCount: value.files.length,
      totalBytes: value.files.reduce((total, file) => total + file.byteLength, 0),
      entrypoints: value.entrypoints,
      files: expectedManifestFiles,
      bundleContentHash: expectedBundleContentHash,
    };
    const manifestProjection = {
      bundleVersion: value.manifest.bundleVersion,
      contractVersion: value.manifest.contractVersion,
      fileCount: value.manifest.fileCount,
      totalBytes: value.manifest.totalBytes,
      entrypoints: value.manifest.entrypoints,
      files: value.manifest.files,
      bundleContentHash: value.manifest.bundleContentHash,
    };
    if (!canonicalValuesMatch(manifestProjection, expectedManifestProjection)) {
      addMismatch(
        context,
        ['manifest'],
        'O manifest deve ser uma projeção exata dos arquivos e entrypoints do bundle.',
      );
    }
    const expectedManifestHash = calculateGeneratedManifestHash(expectedManifestProjection);
    if (value.manifest.manifestHash !== expectedManifestHash) {
      addMismatch(
        context,
        ['manifest', 'manifestHash'],
        'manifestHash deve corresponder ao manifest calculado.',
      );
    }

    const expectedLineage = {
      technicalSpecificationHash: value.lineage.technicalSpecificationHash,
      declaredTechnicalSpecificationHash: value.lineage.declaredTechnicalSpecificationHash,
      qaSpecificationHash: value.lineage.qaSpecificationHash,
      technicalHandoffVerified: true as const,
      files: value.files.map((file) => ({
        path: file.path,
        fileHash: file.fileHash,
        sourceModuleIds: file.sourceModuleIds,
        sourcePlanItemIds: file.sourcePlanItemIds,
      })),
    };
    if (!canonicalValuesMatch(value.lineage, expectedLineage)) {
      addMismatch(
        context,
        ['lineage'],
        'O lineage deve preservar exatamente as referências dos arquivos do bundle.',
      );
    }
    const expectedLineageHash = calculateCodeGenerationLineageHash(expectedLineage);
    const expectedProvenanceHash = calculateCodeGenerationProvenanceHash(value.provenance);
    const expectedBundleHash = calculateGeneratedBundleHash({
      bundleVersion: value.bundleVersion,
      contractVersion: value.contractVersion,
      technicalSpecificationHash: value.technicalSpecificationHash,
      bundleContentHash: expectedBundleContentHash,
      manifestHash: expectedManifestHash,
      lineageHash: expectedLineageHash,
      provenanceHash: expectedProvenanceHash,
    });
    const expectedGenerationHash = calculateCodeGenerationHash({
      bundleVersion: value.bundleVersion,
      contractVersion: value.contractVersion,
      bundleHash: expectedBundleHash,
      bundleContentHash: expectedBundleContentHash,
      promptHash: value.provenance.promptHash,
      responseHash: value.provenance.responseHash,
      validationHash: value.provenance.validationHash,
      assetBundleHash: value.provenance.assetBundleHash,
    });

    const expectedHashes = {
      bundleContentHash: expectedBundleContentHash,
      manifestHash: expectedManifestHash,
      lineageHash: expectedLineageHash,
      provenanceHash: expectedProvenanceHash,
      bundleHash: expectedBundleHash,
      generationHash: expectedGenerationHash,
    };
    for (const [hashName, expectedHash] of Object.entries(expectedHashes)) {
      if (value.hashes[hashName as keyof typeof value.hashes] !== expectedHash) {
        addMismatch(
          context,
          ['hashes', hashName],
          `${hashName} deve corresponder à projeção determinística do bundle.`,
        );
      }
    }

    if (value.technicalSpecificationHash !== value.lineage.technicalSpecificationHash) {
      addMismatch(
        context,
        ['technicalSpecificationHash'],
        'O bundle deve preservar o hash da TechnicalSpecification.',
      );
    }
    if (value.lineage.declaredTechnicalSpecificationHash !== value.technicalSpecificationHash) {
      addMismatch(
        context,
        ['lineage', 'declaredTechnicalSpecificationHash'],
        'O lineage deve correlacionar o hash declarado à TechnicalSpecification materializada.',
      );
    }
    if (value.lineage.qaSpecificationHash !== value.provenance.approval.qaSpecificationHash) {
      addMismatch(
        context,
        ['lineage', 'qaSpecificationHash'],
        'O lineage deve preservar a evidência de QA registrada na aprovação.',
      );
    }
  });

export const codeGeneratorAssetReferenceSchema = z
  .object({ id: identifierSchema, version: semanticVersionSchema, hash: hashSchema })
  .strict();

export const codeGeneratorAssetsMetadataSchema = z
  .object({
    bundleHash: hashSchema,
    manifest: codeGeneratorAssetReferenceSchema,
    template: codeGeneratorAssetReferenceSchema,
    ruleSets: z.array(codeGeneratorAssetReferenceSchema).length(3),
    outputContract: codeGeneratorAssetReferenceSchema,
    validationContract: codeGeneratorAssetReferenceSchema,
  })
  .strict();

export const codeGeneratorKnowledgeMetadataSchema = z
  .object({
    context: z.literal('CODE_GENERATOR'),
    sourceId: knowledgeSourceIdSchema,
    manifestVersion: semanticVersionSchema,
    policyVersion: semanticVersionSchema,
    contextHash: knowledgeHashSchema,
    documents: z.array(
      z
        .object({
          id: knowledgeDocumentIdSchema,
          category: knowledgeCategorySchema,
          hash: knowledgeHashSchema,
        })
        .strict(),
    ),
    budget: knowledgeContextBudgetSchema,
  })
  .strict();

export const codeGeneratorRunMetadataSchema = z
  .object({
    prompt: promptMetadataSchema,
    provider: providerMetadataSchema,
    metrics: agentRunMetricsSchema,
    responseHash: agentRunOutputSchema.shape.responseHash,
    finishReason: agentRunOutputSchema.shape.finishReason,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.prompt.metadata.agent !== 'CODE_GENERATOR') {
      addMismatch(
        context,
        ['prompt', 'metadata', 'agent'],
        'O prompt deve pertencer ao Code Generator.',
      );
    }
  });

export const codeGeneratorResponseValidationSummarySchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(validationIssueSchema),
    metadata: validationMetadataSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const hasError = value.issues.some((issue) => issue.severity === 'ERROR');
    if (value.valid === hasError) {
      addMismatch(context, ['valid'], 'O resumo deve preservar o Response Validator.');
    }
  });

export const codeGenerationMetadataSchema = z
  .object({
    bundleVersion: z.literal(CODE_GENERATOR_BUNDLE_VERSION),
    contractVersion: z.literal(CODE_GENERATOR_CONTRACT_VERSION),
    fileCount: z.number().int().min(1).max(generation.files),
    totalBytes: z.number().int().positive().max(generation.bundleBytes),
    bundleContentHash: hashSchema,
    manifestHash: hashSchema,
    lineageHash: hashSchema,
    provenanceHash: hashSchema,
    bundleHash: hashSchema,
    generationHash: hashSchema,
  })
  .strict();

const resultMetadataBase = {
  assets: codeGeneratorAssetsMetadataSchema,
  knowledge: codeGeneratorKnowledgeMetadataSchema,
  run: codeGeneratorRunMetadataSchema,
  technicalSpecificationHash: knowledgeHashSchema,
  declaredTechnicalSpecificationHash: knowledgeHashSchema,
  approval: codeGenerationApprovalSchema,
};

type CommonResultValue = {
  readonly context: z.infer<typeof codeGeneratorAgentContextSchema>;
  readonly validation: {
    readonly response: z.infer<typeof codeGeneratorResponseValidationSummarySchema>;
  };
  readonly metadata: {
    readonly assets: z.infer<typeof codeGeneratorAssetsMetadataSchema>;
    readonly knowledge: z.infer<typeof codeGeneratorKnowledgeMetadataSchema>;
    readonly run: z.infer<typeof codeGeneratorRunMetadataSchema>;
    readonly technicalSpecificationHash: z.infer<typeof knowledgeHashSchema>;
    readonly declaredTechnicalSpecificationHash: z.infer<typeof knowledgeHashSchema>;
    readonly approval: z.infer<typeof codeGenerationApprovalSchema>;
  };
};

function validateCommonResultMetadata(
  value: CommonResultValue,
  context: z.core.$RefinementCtx,
): void {
  const { assets, knowledge, run } = value.metadata;
  const prompt = run.prompt.metadata;
  const validation = value.validation.response.metadata;
  const validationSource = validation.source;

  if (value.context.executionId !== value.metadata.approval.executionId) {
    addMismatch(
      context,
      ['metadata', 'approval', 'executionId'],
      'A aprovação deve pertencer à execução do resultado.',
    );
  }
  if (
    value.metadata.technicalSpecificationHash !== value.metadata.declaredTechnicalSpecificationHash
  ) {
    addMismatch(
      context,
      ['metadata', 'declaredTechnicalSpecificationHash'],
      'O hash declarado deve corresponder à TechnicalSpecification validada.',
    );
  }

  const expectedValidationSource = {
    executionId: value.context.executionId,
    agentExecutionId: value.context.agentExecutionId,
    ...(value.context.requestId === undefined ? {} : { requestId: value.context.requestId }),
    ...(value.context.traceId === undefined ? {} : { traceId: value.context.traceId }),
    provider: run.provider.provider,
    model: run.provider.responseModel,
    promptHash: prompt.promptHash,
    outputContractHash: prompt.outputContractHash,
    responseHash: run.responseHash,
    finishReason: run.finishReason,
  };
  if (!canonicalValuesMatch(validationSource, expectedValidationSource)) {
    addMismatch(
      context,
      ['validation', 'response', 'metadata', 'source'],
      'A origem da validação deve corresponder à execução, ao prompt e ao provider.',
    );
  }

  if (
    prompt.promptId !== assets.template.id ||
    prompt.version !== assets.template.version ||
    prompt.templateHash !== assets.template.hash
  ) {
    addMismatch(
      context,
      ['metadata', 'run', 'prompt', 'metadata'],
      'Os metadados do template devem corresponder aos assets registrados.',
    );
  }
  const promptRuleSets = prompt.ruleSetHashes
    .map((ruleSet) => ({
      id: ruleSet.ruleSetId,
      version: ruleSet.version,
      hash: ruleSet.hash,
    }))
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  const assetRuleSets = [...assets.ruleSets].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  );
  if (!canonicalValuesMatch(promptRuleSets, assetRuleSets)) {
    addMismatch(
      context,
      ['metadata', 'assets', 'ruleSets'],
      'Os rule sets devem corresponder à proveniência do prompt.',
    );
  }
  if (
    prompt.outputContractHash !== assets.outputContract.hash ||
    validationSource.outputContractHash !== assets.outputContract.hash
  ) {
    addMismatch(
      context,
      ['metadata', 'assets', 'outputContract'],
      'O output contract deve corresponder ao prompt e à validação.',
    );
  }
  if (
    validation.contract.id !== assets.validationContract.id ||
    validation.contract.version !== assets.validationContract.version ||
    validation.contract.contractHash !== assets.validationContract.hash
  ) {
    addMismatch(
      context,
      ['metadata', 'assets', 'validationContract'],
      'O contrato de validação deve corresponder ao asset registrado.',
    );
  }
  const expectedAssetBundleHash = calculateCodeGeneratorAssetBundleHash({
    manifest: assets.manifest,
    template: assets.template,
    ruleSets: assets.ruleSets,
    outputContract: assets.outputContract,
    validationContract: assets.validationContract,
  });
  if (assets.bundleHash !== expectedAssetBundleHash) {
    addMismatch(
      context,
      ['metadata', 'assets', 'bundleHash'],
      'O hash do bundle de assets deve corresponder a todas as referências registradas.',
    );
  }

  const knowledgeContexts = prompt.contextHashes.filter(
    (promptContext) =>
      promptContext.kind === 'KNOWLEDGE' && promptContext.contentHash === knowledge.contextHash,
  );
  if (knowledgeContexts.length !== 1) {
    addMismatch(
      context,
      ['metadata', 'knowledge', 'contextHash'],
      'O contexto de Knowledge deve possuir uma única evidência no prompt.',
    );
  } else {
    const promptKnowledgeDocuments = [...knowledgeContexts[0]!.references].sort((left, right) =>
      compareCodeUnits(left.id, right.id),
    );
    const metadataKnowledgeDocuments = [...knowledge.documents].sort((left, right) =>
      compareCodeUnits(left.id, right.id),
    );
    if (!canonicalValuesMatch(promptKnowledgeDocuments, metadataKnowledgeDocuments)) {
      addMismatch(
        context,
        ['metadata', 'knowledge', 'documents'],
        'Os documentos de Knowledge devem corresponder às referências do prompt.',
      );
    }
  }
  const specificationContexts = prompt.contextHashes.filter(
    (promptContext) =>
      promptContext.kind === 'ARTIFACT' &&
      promptContext.contentHash === value.metadata.technicalSpecificationHash,
  );
  if (specificationContexts.length !== 1) {
    addMismatch(
      context,
      ['metadata', 'technicalSpecificationHash'],
      'A TechnicalSpecification deve possuir uma única evidência no prompt.',
    );
  }
}

const generatedResultSchema = z
  .object({
    outcome: z.literal('GENERATED'),
    context: codeGeneratorAgentContextSchema,
    bundle: generatedCodeBundleSchema,
    validation: z
      .object({
        response: codeGeneratorResponseValidationSummarySchema.safeExtend({
          valid: z.literal(true),
        }),
        business: codeGeneratorBusinessValidationResultSchema.safeExtend({
          valid: z.literal(true),
        }),
      })
      .strict(),
    metadata: z
      .object({ ...resultMetadataBase, generation: codeGenerationMetadataSchema })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    validateCommonResultMetadata(value, context);

    const expectedGeneration = {
      bundleVersion: value.bundle.bundleVersion,
      contractVersion: value.bundle.contractVersion,
      fileCount: value.bundle.manifest.fileCount,
      totalBytes: value.bundle.manifest.totalBytes,
      bundleContentHash: value.bundle.bundleContentHash,
      manifestHash: value.bundle.hashes.manifestHash,
      lineageHash: value.bundle.hashes.lineageHash,
      provenanceHash: value.bundle.hashes.provenanceHash,
      bundleHash: value.bundle.hashes.bundleHash,
      generationHash: value.bundle.hashes.generationHash,
    };
    if (!canonicalValuesMatch(value.metadata.generation, expectedGeneration)) {
      addMismatch(
        context,
        ['metadata', 'generation'],
        'A metadata de geração deve corresponder integralmente ao bundle.',
      );
    }
    if (
      value.bundle.technicalSpecificationHash !== value.metadata.technicalSpecificationHash ||
      value.bundle.lineage.declaredTechnicalSpecificationHash !==
        value.metadata.declaredTechnicalSpecificationHash
    ) {
      addMismatch(
        context,
        ['metadata', 'technicalSpecificationHash'],
        'O resultado deve preservar os hashes calculado e declarado da TechnicalSpecification.',
      );
    }
    if (!canonicalValuesMatch(value.bundle.provenance.approval, value.metadata.approval)) {
      addMismatch(
        context,
        ['metadata', 'approval'],
        'A aprovação deve corresponder à provenance do bundle.',
      );
    }
    if (
      value.bundle.provenance.agentVersion !== value.context.agentVersion ||
      value.bundle.provenance.assetBundleHash !== value.metadata.assets.bundleHash ||
      value.bundle.provenance.knowledgeContextHash !== value.metadata.knowledge.contextHash ||
      value.bundle.provenance.promptHash !== value.metadata.run.prompt.metadata.promptHash ||
      value.bundle.provenance.responseHash !== value.metadata.run.responseHash ||
      value.bundle.provenance.validationHash !==
        value.validation.response.metadata.validationHash ||
      value.bundle.provenance.provider !== value.metadata.run.provider.provider ||
      value.bundle.provenance.model !== value.metadata.run.provider.responseModel
    ) {
      addMismatch(
        context,
        ['bundle', 'provenance'],
        'A provenance deve corresponder aos assets, Knowledge, run e validação do resultado.',
      );
    }
  });

const rejectedResultSchema = z
  .object({
    outcome: z.literal('VALIDATION_REJECTED'),
    rejectedAt: z.enum(['RESPONSE_VALIDATION', 'BUSINESS_VALIDATION']),
    context: codeGeneratorAgentContextSchema,
    bundle: z.null(),
    validation: z
      .object({
        response: codeGeneratorResponseValidationSummarySchema,
        business: codeGeneratorBusinessValidationResultSchema.nullable(),
      })
      .strict(),
    metadata: z.object({ ...resultMetadataBase, generation: z.null() }).strict(),
  })
  .strict()
  .superRefine((value, context) => {
    validateCommonResultMetadata(value, context);
    const validResponseRejection =
      value.rejectedAt === 'RESPONSE_VALIDATION' &&
      !value.validation.response.valid &&
      value.validation.business === null;
    const validBusinessRejection =
      value.rejectedAt === 'BUSINESS_VALIDATION' &&
      value.validation.response.valid &&
      value.validation.business?.valid === false;
    if (!validResponseRejection && !validBusinessRejection) {
      addMismatch(context, ['validation'], 'A etapa de rejeição deve corresponder às validações.');
    }
  });

export const codeGeneratorAgentResultSchema = z.discriminatedUnion('outcome', [
  generatedResultSchema,
  rejectedResultSchema,
]);
