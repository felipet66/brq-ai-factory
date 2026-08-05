import type { ValidateFunction } from 'ajv';

import type { JsonValue } from '@brq/shared/types/json-value';

import type { ValidatedOutput, ValidationIssue, ValidationRequest } from '../contracts';

export interface ValidationReport {
  readonly request: ValidationRequest;
  readonly maxIssues: number;
  readonly issues: ValidationIssue[];
  issuesTruncated: boolean;
  halted: boolean;
  contractHash: string;
  contentHash: string;
  parsedValue: JsonValue | undefined;
  validatedOutput: ValidatedOutput | null;
  schemaValidator: ValidateFunction | undefined;
}

export function createValidationReport(
  request: ValidationRequest,
  maxIssues: number,
  contractHash: string,
  contentHash: string,
): ValidationReport {
  return {
    request,
    maxIssues,
    issues: [],
    issuesTruncated: false,
    halted: false,
    contractHash,
    contentHash,
    parsedValue: undefined,
    validatedOutput: null,
    schemaValidator: undefined,
  };
}

export function addIssue(report: ValidationReport, issue: ValidationIssue): void {
  if (report.issues.length >= report.maxIssues) {
    report.issuesTruncated = true;
    return;
  }

  report.issues.push(issue);
}

export function addIssues(report: ValidationReport, issues: readonly ValidationIssue[]): void {
  for (const issue of issues) addIssue(report, issue);
}

export function halt(report: ValidationReport): void {
  report.halted = true;
}

export function hasErrors(report: ValidationReport): boolean {
  return report.issues.some((issue) => issue.severity === 'ERROR');
}
