import type { ResponseValidatorConfiguration } from '../configuration';
import { calculateCanonicalHash } from '../hashing';
import {
  structuredDataMismatchIssue,
  structuredDataNestingTooDeepIssue,
  structuredDataSchemaMismatchIssue,
  structuredDataUnavailableIssue,
} from '../issues';
import { schemaErrors } from '../json-schema-validator';
import { nestingDepth } from './content-stage';
import { addIssue, type ValidationReport } from './validation-report';

export function validateStructuredOutput(
  report: ValidationReport,
  configuration: ResponseValidatorConfiguration,
): void {
  if (report.halted) return;

  const structuredData = report.request.runResult.output.structuredData;

  if (report.request.contract.format === 'TEXT') {
    report.validatedOutput = {
      format: 'TEXT',
      content: report.request.runResult.output.content,
    };
    return;
  }

  if (report.schemaValidator === undefined || report.parsedValue === undefined) {
    throw new TypeError('Pipeline de structured output incompleto.');
  }

  if (structuredData === null) {
    if (report.parsedValue !== null) addIssue(report, structuredDataUnavailableIssue());
    report.validatedOutput = { format: 'JSON_SCHEMA', data: report.parsedValue };
    return;
  }

  if (nestingDepth(structuredData) > configuration.maxNestingDepth) {
    addIssue(report, structuredDataNestingTooDeepIssue());
  } else if (!report.schemaValidator(structuredData)) {
    for (const error of schemaErrors(report.schemaValidator)) {
      if (report.issues.length < report.maxIssues) {
        report.diagnosticCollector?.capture(
          error,
          structuredData,
          'STRUCTURED_DATA_SCHEMA_MISMATCH',
        );
      }
      addIssue(report, structuredDataSchemaMismatchIssue(error));
    }
  }

  if (calculateCanonicalHash(structuredData) !== calculateCanonicalHash(report.parsedValue)) {
    addIssue(report, structuredDataMismatchIssue());
  }

  report.validatedOutput = { format: 'JSON_SCHEMA', data: report.parsedValue };
}
