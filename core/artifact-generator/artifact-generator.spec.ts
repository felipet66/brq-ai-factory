import { describe, expect, it } from 'vitest';

import { createArtifactGenerator } from './artifact-generator';
import { ARTIFACT_GENERATOR_ERROR_CODES } from './errors';
import {
  createArtifactGenerationRequest,
  createArtifactSpecification,
  createDataTemplate,
  createRejectedValidationResult,
  createSummaryTemplate,
  createValidatedJsonResult,
  createValidatedTextResult,
  HASH_A,
  HASH_B,
} from './testing/artifact-generator-fixtures';

describe('Artifact Generator', () => {
  it('generates an ordered immutable batch from a valid JSON result', () => {
    const generator = createArtifactGenerator();
    const result = generator.generate(createArtifactGenerationRequest());

    expect(result.artifacts.map(({ draft }) => draft.filename)).toEqual([
      'summary.md',
      'data.json',
    ]);
    expect(result.artifacts[0]?.draft).toEqual({
      name: 'Summary',
      filename: 'summary.md',
      type: 'SUMMARY',
      content: '# Resumo genérico\n\nConteúdo fictício para teste.',
    });
    expect(result.artifacts[1]?.draft.content).toBe(
      '[\n  {\n    "id": "ITEM-001",\n    "value": "Detalhe fictício."\n  }\n]\n',
    );
    expect(result.metadata).toMatchObject({
      specificationId: 'default-artifact-specification',
      specificationVersion: '1.0.0',
      artifactCount: 2,
      source: {
        executionId: 'execution-1',
        agentExecutionId: 'agent-execution-1',
        contractId: 'agent-output-contract',
        contractFormat: 'JSON_SCHEMA',
      },
    });
    expect(result.metadata.totalBytes).toBe(
      result.artifacts.reduce((total, artifact) => total + artifact.metadata.byteLength, 0),
    );
    expect(Object.isFrozen(generator)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.artifacts)).toBe(true);
    expect(result.artifacts.every(Object.isFrozen)).toBe(true);
  });

  it('supports a validated TEXT source through an explicit root binding', () => {
    const validation = createValidatedTextResult('Texto original {{não-interpolar}}.');
    const specification = createArtifactSpecification({
      sourceContract: validation.metadata.contract,
      templates: [
        createSummaryTemplate({
          bindings: [{ id: 'root', path: [] }],
          fragments: [{ kind: 'BINDING', bindingId: 'root', serialization: 'TEXT' }],
        }),
      ],
    });

    const result = createArtifactGenerator().generate({ validation, specification });

    expect(result.artifacts[0]?.draft.content).toBe('Texto original {{não-interpolar}}.');
  });

  it('preserves source metadata and both validation integrity hashes', () => {
    const request = createArtifactGenerationRequest();
    const result = createArtifactGenerator().generate(request);

    expect(result.metadata.source).toEqual({
      executionId: request.validation.metadata.source.executionId,
      agentExecutionId: request.validation.metadata.source.agentExecutionId,
      requestId: request.validation.metadata.source.requestId,
      traceId: request.validation.metadata.source.traceId,
      provider: request.validation.metadata.source.provider,
      model: request.validation.metadata.source.model,
      promptHash: request.validation.metadata.source.promptHash,
      outputContractHash: request.validation.metadata.source.outputContractHash,
      responseHash: request.validation.metadata.source.responseHash,
      finishReason: request.validation.metadata.source.finishReason,
      contractId: request.validation.metadata.contract.id,
      contractVersion: request.validation.metadata.contract.version,
      contractFormat: request.validation.metadata.contract.format,
      contractHash: request.validation.metadata.contract.contractHash,
      validationHash: request.validation.metadata.validationHash,
      validatedValueHash: request.validation.metadata.validatedValueHash,
    });
  });

  it('rejects a rejected validation result and a mismatched source contract', () => {
    const rejected = createRejectedValidationResult();
    const rejectedRequest = createArtifactGenerationRequest({
      validation: rejected,
      specification: createArtifactSpecification({ sourceContract: rejected.metadata.contract }),
    });
    const mismatch = createArtifactGenerationRequest();

    expect(() => createArtifactGenerator().generate(rejectedRequest)).toThrowError(
      expect.objectContaining({
        code: ARTIFACT_GENERATOR_ERROR_CODES.SOURCE_VALIDATION_REJECTED,
        classification: 'GENERATION',
      }),
    );
    expect(() =>
      createArtifactGenerator().generate({
        ...mismatch,
        specification: {
          ...mismatch.specification,
          sourceContract: { ...mismatch.specification.sourceContract, contractHash: HASH_B },
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: ARTIFACT_GENERATOR_ERROR_CODES.SOURCE_CONTRACT_MISMATCH,
        stage: 'SPECIFICATION_VALIDATION',
      }),
    );
  });

  it('recomputes and rejects a forged validated value hash', () => {
    const validation = createValidatedJsonResult();
    const request = createArtifactGenerationRequest({
      validation: {
        ...validation,
        metadata: { ...validation.metadata, validatedValueHash: HASH_A },
      },
    });

    expect(() => createArtifactGenerator().generate(request)).toThrowError(
      expect.objectContaining({
        code: ARTIFACT_GENERATOR_ERROR_CODES.SOURCE_INTEGRITY_MISMATCH,
        stage: 'SOURCE_INTEGRITY_VALIDATION',
      }),
    );
  });

  it('preserves correlation IDs and measures failures through the catch boundary', () => {
    const rejected = createRejectedValidationResult();
    const request = createArtifactGenerationRequest({
      validation: rejected,
      specification: createArtifactSpecification({ sourceContract: rejected.metadata.contract }),
    });
    const ticks = [0, 1, 2, 9];

    expect(() =>
      createArtifactGenerator({ now: () => ticks.shift() ?? 9 }).generate(request),
    ).toThrowError(
      expect.objectContaining({
        code: ARTIFACT_GENERATOR_ERROR_CODES.SOURCE_VALIDATION_REJECTED,
        durationMs: 9,
        executionId: rejected.metadata.source.executionId,
        agentExecutionId: rejected.metadata.source.agentExecutionId,
        requestId: rejected.metadata.source.requestId,
        traceId: rejected.metadata.source.traceId,
      }),
    );
  });

  it('enforces exact aggregate byte budgets without truncating output', () => {
    const request = createArtifactGenerationRequest();
    const baseline = createArtifactGenerator().generate(request);
    const largestArtifact = Math.max(
      ...baseline.artifacts.map((artifact) => artifact.metadata.byteLength),
    );

    expect(
      createArtifactGenerator({
        configuration: {
          maxArtifactBytes: largestArtifact,
          maxTotalBytes: baseline.metadata.totalBytes,
        },
      }).generate(request),
    ).toEqual(baseline);
    expect(() =>
      createArtifactGenerator({
        configuration: {
          maxArtifactBytes: largestArtifact,
          maxTotalBytes: baseline.metadata.totalBytes - 1,
        },
      }).generate(request),
    ).toThrowError(
      expect.objectContaining({ code: ARTIFACT_GENERATOR_ERROR_CODES.CONTENT_LIMIT_EXCEEDED }),
    );
  });

  it('fails atomically when a later template cannot resolve its binding', () => {
    const request = createArtifactGenerationRequest({
      specification: createArtifactSpecification({
        templates: [
          createSummaryTemplate(),
          createDataTemplate({
            bindings: [{ id: 'missing', path: ['notPresent'] }],
            rootBindingId: 'missing',
          }),
        ],
      }),
    });
    let result: unknown;

    expect(() => {
      result = createArtifactGenerator().generate(request);
    }).toThrowError(
      expect.objectContaining({
        code: ARTIFACT_GENERATOR_ERROR_CODES.BINDING_NOT_FOUND,
        templateId: 'data-template',
      }),
    );
    expect(result).toBeUndefined();
  });

  it('does not mutate either the validation result or the specification', () => {
    const request = createArtifactGenerationRequest();
    const snapshot = JSON.stringify(request);

    createArtifactGenerator().generate(request);

    expect(JSON.stringify(request)).toBe(snapshot);
  });

  it('produces the same public result for the same request independently from timing', () => {
    const request = createArtifactGenerationRequest();
    const firstTicks = [0, 1, 2, 3, 4, 5];
    const secondTicks = [100, 120, 160, 220, 300, 400];
    const first = createArtifactGenerator({ now: () => firstTicks.shift() ?? 5 }).generate(request);
    const second = createArtifactGenerator({ now: () => secondTicks.shift() ?? 400 }).generate(
      request,
    );

    expect(second).toEqual(first);
  });

  it('rejects structural limits before returning any artifacts', () => {
    const request = createArtifactGenerationRequest();

    expect(() =>
      createArtifactGenerator({ configuration: { maxArtifacts: 1 } }).generate(request),
    ).toThrowError(
      expect.objectContaining({
        code: ARTIFACT_GENERATOR_ERROR_CODES.SPECIFICATION_LIMIT_EXCEEDED,
        stage: 'SPECIFICATION_VALIDATION',
      }),
    );
  });

  it.each([
    ['fragments per artifact', { maxFragmentsPerArtifact: 1 }],
    ['bindings per artifact', { maxBindingsPerArtifact: 1 }],
    ['binding path depth', { maxBindingPathDepth: 1 }],
    ['specification bytes', { maxSpecificationBytes: 1 }],
  ] as const)('enforces the configured %s limit', (_label, configuration) => {
    expect(() =>
      createArtifactGenerator({ configuration }).generate(createArtifactGenerationRequest()),
    ).toThrowError(
      expect.objectContaining({
        code: ARTIFACT_GENERATOR_ERROR_CODES.SPECIFICATION_LIMIT_EXCEEDED,
        stage: 'SPECIFICATION_VALIDATION',
      }),
    );
  });

  it('enforces the configured source nesting limit', () => {
    expect(() =>
      createArtifactGenerator({ configuration: { maxNestingDepth: 1 } }).generate(
        createArtifactGenerationRequest(),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: ARTIFACT_GENERATOR_ERROR_CODES.SPECIFICATION_LIMIT_EXCEEDED,
        stage: 'SPECIFICATION_VALIDATION',
      }),
    );
  });
});
