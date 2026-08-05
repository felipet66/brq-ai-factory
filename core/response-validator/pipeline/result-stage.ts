import type { JsonValue } from '@brq/shared/types/json-value';

import type { ValidationResult } from '../contracts';
import { calculateCanonicalHash, calculateTextHash } from '../hashing';
import { deepFreeze } from '../immutability';
import { validationResultSchema } from '../schemas';
import { hasErrors, type ValidationReport } from './validation-report';

function validatedValueHash(report: ValidationReport, valid: boolean): string | null {
  if (!valid || report.validatedOutput === null) return null;

  return report.validatedOutput.format === 'TEXT'
    ? calculateTextHash(report.validatedOutput.content)
    : calculateCanonicalHash(report.validatedOutput.data);
}

export function buildValidationResult(report: ValidationReport): ValidationResult {
  const valid = !hasErrors(report);
  const output = valid ? report.validatedOutput : null;
  const valueHash = validatedValueHash(report, valid);
  const { runResult, contract } = report.request;
  const source = {
    executionId: runResult.context.execution.executionId,
    agentExecutionId: runResult.context.execution.agentExecutionId,
    ...(runResult.context.requestId === undefined
      ? {}
      : { requestId: runResult.context.requestId }),
    ...(runResult.context.traceId === undefined ? {} : { traceId: runResult.context.traceId }),
    provider: runResult.provider.provider,
    model: runResult.provider.responseModel,
    promptHash: runResult.prompt.metadata.promptHash,
    outputContractHash: runResult.prompt.metadata.outputContractHash,
    responseHash: runResult.output.responseHash,
    finishReason: runResult.output.finishReason,
  };
  const issueIdentities = report.issues.map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    category: issue.category,
    ...(issue.instancePath === undefined ? {} : { instancePath: issue.instancePath }),
    ...(issue.schemaPath === undefined ? {} : { schemaPath: issue.schemaPath }),
    ...(issue.keyword === undefined ? {} : { keyword: issue.keyword }),
  }));
  const validationHash = calculateCanonicalHash({
    valid,
    contractHash: report.contractHash,
    source,
    contentHash: report.contentHash,
    schemaHash: contract.format === 'JSON_SCHEMA' ? calculateCanonicalHash(contract.schema) : null,
    validatedValueHash: valueHash,
    issues: issueIdentities,
    issuesTruncated: report.issuesTruncated,
  } as unknown as JsonValue);
  const result = validationResultSchema.parse({
    valid,
    validatedOutput: output,
    issues: report.issues,
    metadata: {
      contract: {
        id: contract.id,
        version: contract.version,
        format: contract.format,
        contractHash: report.contractHash,
      },
      source,
      contentHash: report.contentHash,
      schemaHash:
        contract.format === 'JSON_SCHEMA' ? calculateCanonicalHash(contract.schema) : null,
      validatedValueHash: valueHash,
      validationHash,
      issuesTruncated: report.issuesTruncated,
    },
  }) as ValidationResult;

  return deepFreeze(result);
}
