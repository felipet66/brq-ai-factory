import type { AgentRunResult } from '@brq/agent-runner';
import type { ProductOwnerSpecification } from '@brq/product-owner-agent';
import { calculateCanonicalJsonHash } from '@brq/prompt-builder';
import { createResponseValidator, type ValidationIssue } from '@brq/response-validator';
import { createLogger } from '@brq/shared/logger/logger';
import type { DeliveryIntent } from '@brq/shared/types/delivery-intent';
import type { JsonValue } from '@brq/shared/types/json-value';
import type { z } from 'zod';

import { validateDeveloperBusinessRules } from '../business-validation';
import { deepFreeze } from '../immutability';
import { loadDeveloperPromptAssets } from '../prompt-assets';
import { technicalSpecificationSchema } from '../schemas';

const DIAGNOSTIC_HASH_A = 'a'.repeat(64);
const DIAGNOSTIC_HASH_B = 'b'.repeat(64);
const DIAGNOSTIC_HASH_C = 'c'.repeat(64);

export type DeveloperOutputDiagnosticStage =
  'RESPONSE_VALIDATOR' | 'ZOD' | 'BUSINESS_VALIDATION' | 'PASSED';

export interface DeveloperOutputDiagnosticIssue {
  readonly code: string;
  readonly path: string;
  readonly schemaPath: string | null;
  readonly keyword: string | null;
}

export interface DeveloperOutputDiagnosticReport {
  readonly stage: DeveloperOutputDiagnosticStage;
  readonly issueCount: number;
  readonly issues: readonly DeveloperOutputDiagnosticIssue[];
  readonly metadata: {
    readonly contractId: string;
    readonly contractVersion: string;
    readonly contractHash: string;
    readonly schemaHash: string | null;
    readonly candidateHash: string;
    readonly businessContextSource: 'DEFAULT_FIXTURE' | 'PROVIDED';
    readonly deliveryIntentVersion: DeliveryIntent['version'];
    readonly deliveryMode: DeliveryIntent['mode'];
  };
}

export interface DiagnoseDeveloperOutputRequest {
  readonly candidate: JsonValue;
  readonly productOwnerSpecification: ProductOwnerSpecification;
  readonly deliveryIntent: DeliveryIntent;
  readonly businessContextSource: 'DEFAULT_FIXTURE' | 'PROVIDED';
}

function escapeJsonPointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function jsonPointer(path: readonly PropertyKey[]): string {
  const segments = path.flatMap((segment) => {
    if (typeof segment === 'string') return [escapeJsonPointerSegment(segment)];
    if (typeof segment === 'number' && Number.isInteger(segment) && segment >= 0) {
      return [String(segment)];
    }
    return [];
  });

  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

function responseIssue(issue: ValidationIssue): DeveloperOutputDiagnosticIssue {
  return {
    code: issue.code,
    path: issue.instancePath ?? '/',
    schemaPath: issue.schemaPath ?? null,
    keyword: issue.keyword ?? null,
  };
}

function zodIssue(issue: z.core.$ZodIssue): DeveloperOutputDiagnosticIssue {
  return {
    code: 'ZOD_SCHEMA_MISMATCH',
    path: jsonPointer(issue.path),
    schemaPath: null,
    keyword: issue.code,
  };
}

function businessIssue(issue: {
  readonly code: string;
  readonly path: readonly (string | number)[];
}): DeveloperOutputDiagnosticIssue {
  return {
    code: issue.code,
    path: jsonPointer(issue.path),
    schemaPath: null,
    keyword: null,
  };
}

function diagnosticRunResult(candidate: JsonValue, outputContractHash: string): AgentRunResult {
  const content = JSON.stringify(candidate);

  return {
    context: {
      execution: {
        executionId: 'execution-developer-output-diagnostic',
        agentExecutionId: 'agent-execution-developer-output-diagnostic',
        agent: 'DEVELOPER',
        attempt: 1,
        agentVersion: '1.0.0',
      },
      requestId: 'request-developer-output-diagnostic',
      traceId: 'trace-developer-output-diagnostic',
    },
    prompt: {
      metadata: {
        promptId: 'prompt:developer',
        agent: 'DEVELOPER',
        version: '1.0.4',
        schemaVersion: '1.0.0',
        templateHash: DIAGNOSTIC_HASH_A,
        promptHash: DIAGNOSTIC_HASH_B,
        instructionsHash: DIAGNOSTIC_HASH_C,
        inputHash: DIAGNOSTIC_HASH_A,
        outputContractHash,
        sectionHashes: [],
        ruleSetHashes: [],
        contextHashes: [],
      },
      budget: {
        maxBytes: 3,
        usedBytes: 3,
        instructionsBytes: 1,
        inputBytes: 1,
        outputContractBytes: 1,
      },
    },
    outputContract: loadDeveloperPromptAssets().outputContract,
    output: {
      content,
      structuredData: structuredClone(candidate),
      finishReason: 'COMPLETED',
      responseHash: calculateCanonicalJsonHash(candidate),
    },
    provider: {
      provider: 'local-diagnostic',
      requestedModel: 'no-provider',
      responseModel: 'no-provider',
      responseId: 'local-developer-output-diagnostic',
    },
    metrics: {
      observed: {
        totalDurationMs: 0,
        promptBuilderDurationMs: 0,
        providerDurationMs: 0,
        bytesSent: 0,
        bytesReceived: Buffer.byteLength(content, 'utf8'),
      },
      reported: {
        durationMs: 0,
        attempts: 1,
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    },
  };
}

function report(
  stage: DeveloperOutputDiagnosticStage,
  issues: readonly DeveloperOutputDiagnosticIssue[],
  metadata: DeveloperOutputDiagnosticReport['metadata'],
): DeveloperOutputDiagnosticReport {
  return deepFreeze({
    stage,
    issueCount: issues.length,
    issues: [...issues],
    metadata,
  });
}

export function diagnoseDeveloperOutput(
  request: DiagnoseDeveloperOutputRequest,
): DeveloperOutputDiagnosticReport {
  const assets = loadDeveloperPromptAssets();
  const responseValidator = createResponseValidator({
    logger: createLogger({ sink: () => undefined }),
    now: () => 0,
  });
  const validation = responseValidator.validate({
    runResult: diagnosticRunResult(request.candidate, assets.hashes.outputContractHash),
    contract: assets.validationContract,
  });
  const metadata = {
    contractId: validation.metadata.contract.id,
    contractVersion: validation.metadata.contract.version,
    contractHash: validation.metadata.contract.contractHash,
    schemaHash: validation.metadata.schemaHash,
    candidateHash: validation.metadata.source.responseHash,
    businessContextSource: request.businessContextSource,
    deliveryIntentVersion: request.deliveryIntent.version,
    deliveryMode: request.deliveryIntent.mode,
  };

  if (
    !validation.valid ||
    validation.validatedOutput === null ||
    validation.validatedOutput.format !== 'JSON_SCHEMA'
  ) {
    return report('RESPONSE_VALIDATOR', validation.issues.map(responseIssue), metadata);
  }

  const specification = technicalSpecificationSchema.safeParse(validation.validatedOutput.data);
  if (!specification.success) {
    return report('ZOD', specification.error.issues.map(zodIssue), metadata);
  }

  const businessValidation = validateDeveloperBusinessRules(
    specification.data,
    request.productOwnerSpecification,
    request.deliveryIntent,
  );
  if (!businessValidation.valid) {
    return report('BUSINESS_VALIDATION', businessValidation.issues.map(businessIssue), metadata);
  }

  return report('PASSED', [], metadata);
}
