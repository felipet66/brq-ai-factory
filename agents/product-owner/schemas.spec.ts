import { calculateCanonicalJsonHash } from '@brq/prompt-builder';
import { GREENFIELD_DELIVERY_INTENT } from '@brq/shared/constants/delivery-intent';
import { describe, expect, it } from 'vitest';

import {
  productOwnerAgentRequestSchema,
  productOwnerAgentResultSchema,
  productOwnerSpecificationSchema,
  productOwnerSpecificationStructureSchema,
} from './schemas';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const SOURCE_HASH = `sha256:${'c'.repeat(64)}`;

function specification(overrides: Record<string, unknown> = {}) {
  return {
    readiness: 'READY',
    title: 'Demanda funcional',
    summary: 'Resumo fiel da demanda.',
    objective: 'Entregar valor funcional verificável.',
    context: 'Contexto conhecido e limitado ao escopo fornecido.',
    userStory: {
      asA: 'pessoa usuária',
      iWant: 'realizar uma ação',
      soThat: 'obtenha o resultado esperado',
    },
    acceptanceCriteria: [
      {
        id: 'AC-001',
        given: 'um estado válido',
        when: 'a ação ocorrer',
        then: 'o resultado aparece',
      },
    ],
    businessRules: [
      {
        id: 'BR-001',
        description: 'A ação exige um estado válido.',
        source: null,
        condition: 'O estado está disponível.',
        impact: 'MEDIUM',
      },
    ],
    scenarios: [
      {
        id: 'SCN-001',
        title: 'Fluxo principal',
        type: 'MAIN',
        given: ['um estado válido'],
        when: ['a pessoa inicia a ação'],
        then: ['o resultado é apresentado'],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    assumptions: [
      {
        id: 'ASM-001',
        description: 'A informação fornecida está atualizada.',
        requiresValidation: false,
      },
    ],
    dependencies: [{ id: 'DEP-001', description: 'Uma decisão externa conhecida.' }],
    risks: [
      { id: 'RSK-001', description: 'A decisão pode atrasar.', impact: 'LOW', mitigation: null },
    ],
    openQuestions: [],
    outOfScope: [{ id: 'OOS-001', description: 'Implementação técnica.' }],
    definitionOfReady: [{ id: 'DOR-001', criterion: 'Critérios revisados.' }],
    backlogItems: [
      {
        id: 'BL-001',
        title: 'Entregar fluxo principal',
        description: 'Disponibilizar o comportamento funcional descrito.',
        priority: 'HIGH',
        dependencyIds: ['DEP-001'],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    context: {
      executionId: 'execution-1',
      agentExecutionId: 'agent-execution-1',
      attempt: 1,
      agentVersion: '1.0.0',
      requestId: 'request-1',
      traceId: 'trace-1',
    },
    demand: {
      title: 'Demanda funcional',
      description: 'Descrição fornecida pela pessoa usuária.',
      targetUsers: [],
      constraints: [],
    },
    deliveryIntent: GREENFIELD_DELIVERY_INTENT,
    additionalContext: 'Contexto adicional não confiável.',
    model: 'configured-model',
    limits: {
      knowledgeMaxDocuments: 24,
      knowledgeMaxBytes: 64 * 1024,
      promptMaxBytes: 128 * 1024,
      maxOutputTokens: 8_192,
      timeoutMs: 60_000,
    },
    ...overrides,
  };
}

function resultMetadata() {
  const asset = (id: string) => ({ id, version: '1.0.0', hash: HASH_A });
  const knowledgeReference = {
    id: 'knowledge:vision',
    category: 'VISION',
    hash: SOURCE_HASH,
  };
  const knowledgeContext = {
    contextId: 'context:product-owner-knowledge',
    kind: 'KNOWLEDGE',
    serialization: 'TEXT',
    contentHash: SOURCE_HASH,
    references: [knowledgeReference],
  };
  const requestContext = {
    contextId: 'context:product-owner-request',
    kind: 'USER_INPUT',
    serialization: 'JSON',
    contentHash: `sha256:${'d'.repeat(64)}`,
    references: [],
  };
  const validationSource = {
    executionId: 'execution-1',
    agentExecutionId: 'agent-execution-1',
    requestId: 'request-1',
    traceId: 'trace-1',
    provider: 'fake',
    model: 'test-model',
    promptHash: HASH_B,
    outputContractHash: HASH_A,
    responseHash: HASH_A,
    finishReason: 'COMPLETED',
  };

  return {
    assets: {
      bundleHash: HASH_B,
      manifest: asset('assets:product-owner'),
      template: asset('prompt:product-owner'),
      ruleSets: [
        asset('rules:global-baseline'),
        asset('rules:security-baseline'),
        asset('rules:product-owner'),
      ],
      outputContract: asset('contract:product-owner-specification'),
      validationContract: asset('contract:product-owner-specification'),
      artifactSpecification: asset('artifacts:product-owner'),
    },
    knowledge: {
      context: 'PRODUCT_OWNER',
      sourceId: 'knowledge-source',
      manifestVersion: '1.0.0',
      policyVersion: '1.0.0',
      contextHash: SOURCE_HASH,
      documents: [{ id: 'knowledge:vision', category: 'VISION', hash: SOURCE_HASH }],
      budget: {
        maxDocuments: 24,
        maxBytes: 64 * 1024,
        usedDocuments: 1,
        usedBytes: 100,
      },
    },
    sourcePromptContextHash: requestContext.contentHash,
    run: {
      prompt: {
        metadata: {
          promptId: 'prompt:product-owner',
          agent: 'PRODUCT_OWNER',
          version: '1.0.0',
          schemaVersion: '1.0.0',
          templateHash: HASH_A,
          promptHash: HASH_B,
          instructionsHash: HASH_A,
          inputHash: HASH_B,
          outputContractHash: HASH_A,
          sectionHashes: [],
          ruleSetHashes: [
            {
              ruleSetId: 'rules:global-baseline',
              version: '1.0.0',
              scope: 'GLOBAL',
              agent: null,
              hash: HASH_A,
            },
            {
              ruleSetId: 'rules:security-baseline',
              version: '1.0.0',
              scope: 'SECURITY',
              agent: null,
              hash: HASH_A,
            },
            {
              ruleSetId: 'rules:product-owner',
              version: '1.0.0',
              scope: 'AGENT',
              agent: 'PRODUCT_OWNER',
              hash: HASH_A,
            },
          ],
          contextHashes: [
            {
              ...knowledgeContext,
              descriptorHash: calculateCanonicalJsonHash({
                id: knowledgeContext.contextId,
                kind: knowledgeContext.kind,
                serialization: knowledgeContext.serialization,
                contentHash: knowledgeContext.contentHash,
                references: knowledgeContext.references,
              }),
            },
            {
              ...requestContext,
              descriptorHash: calculateCanonicalJsonHash({
                id: requestContext.contextId,
                kind: requestContext.kind,
                serialization: requestContext.serialization,
                contentHash: requestContext.contentHash,
                references: requestContext.references,
              }),
            },
          ],
        },
        budget: {
          maxBytes: 4_096,
          usedBytes: 256,
          instructionsBytes: 128,
          inputBytes: 64,
          outputContractBytes: 64,
        },
      },
      provider: {
        provider: 'fake',
        requestedModel: 'configured-model',
        responseModel: 'test-model',
        responseId: 'response-1',
      },
      metrics: {
        observed: {
          totalDurationMs: 30,
          promptBuilderDurationMs: 10,
          providerDurationMs: 20,
          bytesSent: 200,
          bytesReceived: 100,
        },
        reported: {
          durationMs: 18,
          attempts: 1,
          usage: { inputTokens: 20, outputTokens: 10 },
        },
      },
      responseHash: HASH_A,
      finishReason: 'COMPLETED',
    },
    validationSource,
  };
}

function responseValidation(valid = true) {
  const { validationSource } = resultMetadata();
  return {
    valid,
    issues: valid
      ? []
      : [
          {
            code: 'SCHEMA_MISMATCH',
            severity: 'ERROR',
            category: 'SCHEMA',
            message: 'O conteúdo JSON não atende ao schema no caminho informado.',
          },
        ],
    metadata: {
      contract: {
        id: 'contract:product-owner-specification',
        version: '1.0.0',
        format: 'JSON_SCHEMA',
        contractHash: HASH_A,
      },
      source: validationSource,
      contentHash: HASH_A,
      schemaHash: HASH_B,
      validatedValueHash: valid ? HASH_A : null,
      validationHash: HASH_B,
      issuesTruncated: false,
    },
  };
}

function generatedResult() {
  const metadata = resultMetadata();
  const artifact = (
    filename: string,
    name: string,
    type: string,
    templateId: string,
    format: 'TEXT' | 'JSON',
    mediaType: 'text/markdown' | 'application/json',
    content: string,
  ) => ({
    draft: { name, filename, type, content },
    metadata: {
      templateId,
      format,
      mediaType,
      templateHash: HASH_A,
      contentHash: HASH_B,
      draftHash: HASH_A,
      byteLength: Buffer.byteLength(content),
    },
  });
  const artifacts = [
    artifact(
      'story.md',
      'Product Owner Story',
      'PRODUCT_OWNER_STORY',
      'artifact:product-owner-story',
      'TEXT',
      'text/markdown',
      '# Story\n',
    ),
    artifact(
      'acceptance.md',
      'Product Owner Acceptance',
      'PRODUCT_OWNER_ACCEPTANCE',
      'artifact:product-owner-acceptance',
      'TEXT',
      'text/markdown',
      '# Aceite\n',
    ),
    artifact(
      'backlog.json',
      'Product Owner Backlog',
      'PRODUCT_OWNER_BACKLOG',
      'artifact:product-owner-backlog',
      'JSON',
      'application/json',
      '[]\n',
    ),
  ];
  const totalBytes = artifacts.reduce(
    (total, generatedArtifact) => total + generatedArtifact.metadata.byteLength,
    0,
  );

  return {
    outcome: 'GENERATED',
    context: request().context,
    readiness: 'READY',
    specification: specification(),
    artifacts,
    validation: {
      response: responseValidation(true),
      business: {
        valid: true,
        expectedReadiness: 'READY',
        issues: [],
        issuesTruncated: false,
      },
    },
    metadata: {
      assets: metadata.assets,
      knowledge: metadata.knowledge,
      run: metadata.run,
      sourcePromptContextHash: metadata.sourcePromptContextHash,
      generation: {
        specificationId: 'artifacts:product-owner',
        specificationVersion: '1.0.0',
        specificationHash: HASH_A,
        source: {
          ...metadata.validationSource,
          contractId: 'contract:product-owner-specification',
          contractVersion: '1.0.0',
          contractFormat: 'JSON_SCHEMA',
          contractHash: HASH_A,
          validationHash: HASH_B,
          validatedValueHash: HASH_A,
        },
        artifactCount: 3,
        totalBytes,
        generationHash: HASH_B,
      },
    },
  };
}

describe('Product Owner schemas', () => {
  it('accepts a strict, complete and cross-referenced ProductOwnerSpecification', () => {
    expect(productOwnerSpecificationSchema.safeParse(specification()).success).toBe(true);
  });

  it('allows empty functional lists only for a coherent clarification result', () => {
    const incomplete = specification({
      readiness: 'REQUIRES_CLARIFICATION',
      userStory: null,
      acceptanceCriteria: [],
      businessRules: [],
      scenarios: [],
      assumptions: [],
      dependencies: [],
      risks: [],
      openQuestions: [
        { id: 'Q-001', question: 'Qual resultado deve ser priorizado?', impact: 'BLOCKING' },
      ],
      outOfScope: [],
      definitionOfReady: [],
      backlogItems: [],
    });

    expect(productOwnerSpecificationSchema.safeParse(incomplete).success).toBe(true);
    expect(
      productOwnerSpecificationSchema.safeParse({ ...incomplete, readiness: 'READY' }).success,
    ).toBe(false);
  });

  it('keeps structural parsing separate from Business Validation', () => {
    const structurallyValid = specification({
      readiness: 'READY',
      openQuestions: [
        { id: 'Q-001', question: 'Existe uma decisão pendente?', impact: 'BLOCKING' },
      ],
    });

    expect(productOwnerSpecificationStructureSchema.safeParse(structurallyValid).success).toBe(
      true,
    );
    expect(productOwnerSpecificationSchema.safeParse(structurallyValid).success).toBe(false);
  });

  it('rejects unknown properties, unsafe normalization and invalid stable ID prefixes', () => {
    expect(
      productOwnerSpecificationSchema.safeParse({ ...specification(), implementationPlan: [] })
        .success,
    ).toBe(false);
    expect(
      productOwnerSpecificationSchema.safeParse(specification({ title: ' título ' })).success,
    ).toBe(false);
    expect(
      productOwnerSpecificationSchema.safeParse(
        specification({ scenarios: [{ ...specification().scenarios[0], id: 'SC-001' }] }),
      ).success,
    ).toBe(false);
  });

  it('rejects duplicate IDs and unknown or repeated references', () => {
    const baseline = specification();
    expect(
      productOwnerSpecificationSchema.safeParse(
        specification({
          acceptanceCriteria: [
            ...baseline.acceptanceCriteria,
            { ...baseline.acceptanceCriteria[0] },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      productOwnerSpecificationSchema.safeParse(
        specification({
          scenarios: [
            {
              ...baseline.scenarios[0],
              acceptanceCriteriaIds: ['AC-999', 'AC-999'],
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it('accepts the request envelope and rejects extra fields or excessive technical limits', () => {
    expect(productOwnerAgentRequestSchema.safeParse(request()).success).toBe(true);
    expect(productOwnerAgentRequestSchema.safeParse(request({ apiKey: 'secret' })).success).toBe(
      false,
    );
    expect(
      productOwnerAgentRequestSchema.safeParse(
        request({ limits: { ...request().limits, timeoutMs: 600_001 } }),
      ).success,
    ).toBe(false);
    expect(
      productOwnerAgentRequestSchema.safeParse(
        request({ demand: { ...request().demand, deadline: '2026-02-30' } }),
      ).success,
    ).toBe(false);
  });

  it('accepts a coherent GENERATED result and rejects inconsistent readiness or counts', () => {
    const result = generatedResult();

    expect(productOwnerAgentResultSchema.safeParse(result).success).toBe(true);
    expect(
      productOwnerAgentResultSchema.safeParse({ ...result, readiness: 'PARTIALLY_READY' }).success,
    ).toBe(false);
    expect(
      productOwnerAgentResultSchema.safeParse({
        ...result,
        metadata: {
          ...result.metadata,
          generation: { ...result.metadata.generation, artifactCount: 2 },
        },
      }).success,
    ).toBe(false);
    expect(
      productOwnerAgentResultSchema.safeParse({
        ...result,
        metadata: { ...result.metadata, sourcePromptContextHash: SOURCE_HASH },
      }).success,
    ).toBe(false);
    expect(
      productOwnerAgentResultSchema.safeParse({
        ...result,
        artifacts: [result.artifacts[1], result.artifacts[0], result.artifacts[2]],
      }).success,
    ).toBe(false);
  });

  it('rejects mixed provenance across the pipeline boundaries', () => {
    const result = generatedResult();

    expect(
      productOwnerAgentResultSchema.safeParse({
        ...result,
        validation: {
          ...result.validation,
          response: {
            ...result.validation.response,
            metadata: {
              ...result.validation.response.metadata,
              source: {
                ...result.validation.response.metadata.source,
                responseHash: HASH_B,
              },
            },
          },
        },
      }).success,
    ).toBe(false);

    expect(
      productOwnerAgentResultSchema.safeParse({
        ...result,
        metadata: {
          ...result.metadata,
          generation: {
            ...result.metadata.generation,
            specificationHash: HASH_B,
          },
        },
      }).success,
    ).toBe(false);

    expect(
      productOwnerAgentResultSchema.safeParse({
        ...result,
        metadata: {
          ...result.metadata,
          knowledge: {
            ...result.metadata.knowledge,
            contextHash: `sha256:${'e'.repeat(64)}`,
          },
        },
      }).success,
    ).toBe(false);

    expect(
      productOwnerAgentResultSchema.safeParse({
        ...result,
        metadata: {
          ...result.metadata,
          run: {
            ...result.metadata.run,
            prompt: {
              ...result.metadata.run.prompt,
              metadata: {
                ...result.metadata.run.prompt.metadata,
                ruleSetHashes: result.metadata.run.prompt.metadata.ruleSetHashes.map(
                  (ruleSet, index) => (index === 0 ? { ...ruleSet, hash: HASH_B } : ruleSet),
                ),
              },
            },
          },
        },
      }).success,
    ).toBe(false);

    expect(
      productOwnerAgentResultSchema.safeParse({
        ...result,
        metadata: {
          ...result.metadata,
          generation: {
            ...result.metadata.generation,
            totalBytes: result.metadata.generation.totalBytes + 1,
          },
        },
      }).success,
    ).toBe(false);
  });

  it('distinguishes Response Validation rejection from Business Validation rejection', () => {
    const generated = generatedResult();
    const responseRejected = {
      ...generated,
      outcome: 'VALIDATION_REJECTED',
      rejectedAt: 'RESPONSE_VALIDATION',
      readiness: null,
      specification: null,
      artifacts: [],
      validation: { response: responseValidation(false), business: null },
      metadata: { ...generated.metadata, generation: null },
    };
    const businessRejected = {
      ...responseRejected,
      rejectedAt: 'BUSINESS_VALIDATION',
      validation: {
        response: responseValidation(true),
        business: {
          valid: false,
          expectedReadiness: 'PARTIALLY_READY',
          issuesTruncated: false,
          issues: [
            {
              code: 'PRODUCT_OWNER_READINESS_MISMATCH',
              path: ['readiness'],
              message: 'readiness incompatível.',
            },
          ],
        },
      },
    };

    expect(productOwnerAgentResultSchema.safeParse(responseRejected).success).toBe(true);
    expect(productOwnerAgentResultSchema.safeParse(businessRejected).success).toBe(true);
    expect(
      productOwnerAgentResultSchema.safeParse({
        ...businessRejected,
        rejectedAt: 'RESPONSE_VALIDATION',
      }).success,
    ).toBe(false);
    expect(
      productOwnerAgentResultSchema.safeParse({
        ...businessRejected,
        validation: {
          ...businessRejected.validation,
          business: {
            ...businessRejected.validation.business,
            issuesTruncated: true,
          },
        },
      }).success,
    ).toBe(false);
  });
});
