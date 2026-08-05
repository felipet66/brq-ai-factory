import type { ValidationResult } from '@brq/response-validator';

import type {
  ArtifactGenerationRequest,
  ArtifactSpecification,
  JsonArtifactTemplate,
  TextArtifactTemplate,
} from '../contracts';
import { calculateValidatedValueHash } from '../content-hashing';

export const HASH_A = 'a'.repeat(64);
export const HASH_B = 'b'.repeat(64);
export const HASH_C = 'c'.repeat(64);
export const HASH_D = 'd'.repeat(64);
export const HASH_E = 'e'.repeat(64);
export const HASH_F = 'f'.repeat(64);

export function createValidatedJsonResult(
  data: ValidationResult['validatedOutput'] extends infer Output
    ? Output extends { readonly format: 'JSON_SCHEMA'; readonly data: infer Data }
      ? Data
      : never
    : never = {
    summary: {
      title: 'Resumo genérico',
      body: 'Conteúdo fictício para teste.',
    },
    details: [
      {
        id: 'ITEM-001',
        value: 'Detalhe fictício.',
      },
    ],
  },
): ValidationResult {
  const validatedOutput = { format: 'JSON_SCHEMA' as const, data };
  return {
    valid: true,
    validatedOutput,
    issues: [],
    metadata: {
      contract: {
        id: 'agent-output-contract',
        version: '1.0.0',
        format: 'JSON_SCHEMA',
        contractHash: HASH_A,
      },
      source: {
        executionId: 'execution-1',
        agentExecutionId: 'agent-execution-1',
        requestId: 'request-1',
        traceId: 'trace-1',
        provider: 'fake',
        model: 'test-model',
        promptHash: HASH_B,
        outputContractHash: HASH_C,
        responseHash: HASH_D,
        finishReason: 'COMPLETED',
      },
      contentHash: HASH_E,
      schemaHash: HASH_F,
      validatedValueHash: calculateValidatedValueHash(validatedOutput),
      validationHash: HASH_C,
      issuesTruncated: false,
    },
  };
}

export function createValidatedTextResult(
  content = 'Resposta textual validada.',
): ValidationResult {
  const validatedOutput = { format: 'TEXT' as const, content };
  return {
    ...createValidatedJsonResult(),
    validatedOutput,
    metadata: {
      ...createValidatedJsonResult().metadata,
      contract: {
        id: 'text-output-contract',
        version: '1.0.0',
        format: 'TEXT',
        contractHash: HASH_D,
      },
      schemaHash: null,
      validatedValueHash: calculateValidatedValueHash(validatedOutput),
      validationHash: HASH_F,
    },
  };
}

export function createRejectedValidationResult(): ValidationResult {
  return {
    ...createValidatedJsonResult(),
    valid: false,
    validatedOutput: null,
    issues: [
      {
        code: 'CONTENT_MISSING',
        severity: 'ERROR',
        category: 'CONTENT',
        message: 'O conteúdo está ausente.',
      },
    ],
    metadata: {
      ...createValidatedJsonResult().metadata,
      validatedValueHash: null,
    },
  };
}

export function createSummaryTemplate(
  overrides: Partial<TextArtifactTemplate> = {},
): TextArtifactTemplate {
  return {
    id: 'summary-template',
    name: 'Summary',
    filename: 'summary.md',
    type: 'SUMMARY',
    mediaType: 'text/markdown',
    format: 'TEXT',
    bindings: [
      { id: 'summary-title', path: ['summary', 'title'] },
      { id: 'summary-body', path: ['summary', 'body'] },
    ],
    fragments: [
      { kind: 'LITERAL', value: '# ' },
      { kind: 'BINDING', bindingId: 'summary-title', serialization: 'TEXT' },
      { kind: 'LITERAL', value: '\n\n' },
      { kind: 'BINDING', bindingId: 'summary-body', serialization: 'TEXT' },
    ],
    ...overrides,
  };
}

export function createDataTemplate(
  overrides: Partial<JsonArtifactTemplate> = {},
): JsonArtifactTemplate {
  return {
    id: 'data-template',
    name: 'Structured data',
    filename: 'data.json',
    type: 'STRUCTURED_DATA',
    mediaType: 'application/json',
    format: 'JSON',
    bindings: [{ id: 'details', path: ['details'] }],
    rootBindingId: 'details',
    ...overrides,
  };
}

export function createArtifactSpecification(
  overrides: Partial<ArtifactSpecification> = {},
): ArtifactSpecification {
  const validation = createValidatedJsonResult();
  return {
    id: 'default-artifact-specification',
    version: '1.0.0',
    sourceContract: validation.metadata.contract,
    templates: [createSummaryTemplate(), createDataTemplate()],
    ...overrides,
  };
}

export function createArtifactGenerationRequest(
  overrides: Partial<ArtifactGenerationRequest> = {},
): ArtifactGenerationRequest {
  const validation = createValidatedJsonResult();
  return {
    validation,
    specification: createArtifactSpecification({ sourceContract: validation.metadata.contract }),
    ...overrides,
  };
}
