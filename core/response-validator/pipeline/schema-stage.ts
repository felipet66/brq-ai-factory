import { schemaMismatchIssue } from '../issues';
import { schemaErrors } from '../json-schema-validator';
import { addIssues, halt, type ValidationReport } from './validation-report';

export function validateSchema(report: ValidationReport): void {
  if (report.halted || report.request.contract.format === 'TEXT') return;

  if (report.schemaValidator === undefined || report.parsedValue === undefined) {
    throw new TypeError('Pipeline JSON Schema incompleto.');
  }

  if (!report.schemaValidator(report.parsedValue)) {
    addIssues(report, schemaErrors(report.schemaValidator).map(schemaMismatchIssue));
    halt(report);
  }
}
