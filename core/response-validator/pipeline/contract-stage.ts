import type { JsonValue } from '@brq/shared/types/json-value';

import type { ResponseValidatorConfiguration } from '../configuration';
import type { ValidationRequest } from '../contracts';
import { RESPONSE_VALIDATOR_ERROR_CODES, ResponseValidatorError } from '../errors';
import { calculateCanonicalHash, canonicalByteLength } from '../hashing';
import { compileJsonSchema } from '../json-schema-validator';
import type { ValidationReport } from './validation-report';

function contractMatchesRunResult(request: ValidationRequest): boolean {
  const { contract, runResult } = request;
  const outputContract = runResult.outputContract;

  if (
    contract.id !== outputContract.id ||
    contract.version !== outputContract.version ||
    contract.format !== outputContract.format ||
    contract.expectedOutputContractHash !== runResult.prompt.metadata.outputContractHash
  ) {
    return false;
  }

  return (
    contract.format === 'TEXT' ||
    (outputContract.format === 'JSON_SCHEMA' &&
      calculateCanonicalHash(contract.schema) === calculateCanonicalHash(outputContract.schema))
  );
}

export function validateContract(
  report: ValidationReport,
  configuration: ResponseValidatorConfiguration,
  durationMs: number,
): void {
  const { request } = report;
  const { executionId, agentExecutionId } = request.runResult.context.execution;

  if (!contractMatchesRunResult(request)) {
    throw new ResponseValidatorError(
      'O contrato de validação não corresponde ao contrato usado na execução.',
      {
        code: RESPONSE_VALIDATOR_ERROR_CODES.INVALID_CONTRACT,
        stage: 'CONTRACT',
        durationMs,
        executionId,
        agentExecutionId,
      },
    );
  }

  if (
    canonicalByteLength(request.contract as unknown as JsonValue) > configuration.maxSchemaBytes
  ) {
    throw new ResponseValidatorError('Contrato de validação excede o limite configurado.', {
      code: RESPONSE_VALIDATOR_ERROR_CODES.INVALID_CONTRACT,
      stage: 'CONTRACT',
      durationMs,
      executionId,
      agentExecutionId,
    });
  }

  if (request.contract.format === 'JSON_SCHEMA') {
    report.schemaValidator = compileJsonSchema(
      request.contract.schema,
      configuration,
      durationMs,
      executionId,
      agentExecutionId,
    ).validate;
  }
}
