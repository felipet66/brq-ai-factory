import { schemaMismatchIssue } from '../issues';
import { schemaErrors } from '../json-schema-validator';
import { addIssue, halt, type ValidationReport } from './validation-report';

export function validateSchema(report: ValidationReport): void {
  if (report.halted || report.request.contract.format === 'TEXT') return;

  if (report.schemaValidator === undefined || report.parsedValue === undefined) {
    throw new TypeError('Pipeline JSON Schema incompleto.');
  }

  if (!report.schemaValidator(report.parsedValue)) {
    for (const error of schemaErrors(report.schemaValidator)) {
      if (report.issues.length < report.maxIssues) {
        report.diagnosticCollector?.capture(error, report.parsedValue, 'SCHEMA_MISMATCH');
      }
      addIssue(report, schemaMismatchIssue(error));
    }
    halt(report);
  }
}
