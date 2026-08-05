import type { ResponseValidatorConfiguration } from '../configuration';
import type { ValidationResult } from '../contracts';
import type { ResponseValidationStage } from '../errors';
import { validateContent } from './content-stage';
import { validateContract } from './contract-stage';
import { buildValidationResult } from './result-stage';
import { validateSchema } from './schema-stage';
import { validateStructuredOutput } from './structured-output-stage';
import type { ValidationReport } from './validation-report';

interface ValidationPipelineOptions {
  readonly elapsedMs: () => number;
  readonly onStage: (stage: Exclude<ResponseValidationStage, 'REQUEST'>) => void;
}

export function executeValidationPipeline(
  report: ValidationReport,
  configuration: ResponseValidatorConfiguration,
  options: ValidationPipelineOptions,
): ValidationResult {
  options.onStage('CONTRACT');
  validateContract(report, configuration, options.elapsedMs());

  options.onStage('CONTENT');
  validateContent(report, configuration);

  options.onStage('SCHEMA');
  validateSchema(report);

  options.onStage('STRUCTURED_OUTPUT');
  validateStructuredOutput(report, configuration);

  options.onStage('RESULT');
  return buildValidationResult(report);
}
