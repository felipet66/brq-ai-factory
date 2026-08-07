import type { ErrorObject } from 'ajv';

import type { JsonValue } from '@brq/shared/types/json-value';

import type { ValidationResult } from './contracts';
import { deepFreeze } from './immutability';
import { boundedTechnicalPath, schemaIssuePath } from './issues';

export const STRUCTURED_OUTPUT_DEBUG_VERSION = '1.0.0' as const;

export type StructuredOutputFoundType =
  'MISSING' | 'NULL' | 'ARRAY' | 'OBJECT' | 'STRING' | 'INTEGER' | 'NUMBER' | 'BOOLEAN' | 'UNKNOWN';

export type StructuredOutputDiagnosticIssueCode =
  'SCHEMA_MISMATCH' | 'STRUCTURED_DATA_SCHEMA_MISMATCH';

export interface StructuredOutputDiagnosticIssue {
  readonly code: StructuredOutputDiagnosticIssueCode;
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
  readonly sanitizedMessage: string;
  readonly foundType: StructuredOutputFoundType;
}

export interface StructuredOutputDebugReport {
  readonly diagnosticVersion: typeof STRUCTURED_OUTPUT_DEBUG_VERSION;
  readonly executionId: string;
  readonly agentExecutionId: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly contract: {
    readonly id: string;
    readonly version: string;
    readonly contractHash: string;
    readonly schemaHash: string;
  };
  readonly responseHash: string;
  readonly issueCount: number;
  readonly issuesTruncated: boolean;
  readonly issues: readonly StructuredOutputDiagnosticIssue[];
}

export type StructuredOutputDebugReporter = (
  report: StructuredOutputDebugReport,
) => void | PromiseLike<void>;

export interface StructuredOutputDiagnosticCollector {
  capture(error: ErrorObject, value: JsonValue, code: StructuredOutputDiagnosticIssueCode): void;
  buildReport(result: ValidationResult): StructuredOutputDebugReport | null;
}

const SANITIZED_AJV_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  additionalProperties: 'must not contain properties outside the configured schema',
  allOf: 'must satisfy every configured schema branch',
  anyOf: 'must satisfy at least one configured schema branch',
  const: 'must match the configured constant',
  contains: 'must contain items satisfying the configured schema',
  dependentRequired: 'must include the configured dependent properties',
  enum: 'must match one of the configured values',
  exclusiveMaximum: 'must satisfy the configured exclusive maximum',
  exclusiveMinimum: 'must satisfy the configured exclusive minimum',
  format: 'must match the configured format',
  if: 'must satisfy the configured conditional schema',
  maxContains: 'must satisfy the configured maximum matching-item count',
  maxItems: 'must satisfy the configured maximum item count',
  maxLength: 'must satisfy the configured maximum length',
  maxProperties: 'must satisfy the configured maximum property count',
  maximum: 'must satisfy the configured maximum',
  minContains: 'must satisfy the configured minimum matching-item count',
  minItems: 'must satisfy the configured minimum item count',
  minLength: 'must satisfy the configured minimum length',
  minProperties: 'must satisfy the configured minimum property count',
  minimum: 'must satisfy the configured minimum',
  multipleOf: 'must satisfy the configured numeric multiple',
  not: 'must not satisfy the prohibited schema',
  oneOf: 'must satisfy exactly one configured schema branch',
  pattern: 'must match the configured pattern',
  propertyNames: 'must use property names accepted by the configured schema',
  required: 'must include the configured required property',
  type: 'must match the configured type',
  uniqueItems: 'must contain unique items',
});

function sanitizedAjvMessage(error: ErrorObject): string {
  return SANITIZED_AJV_MESSAGES[error.keyword] ?? 'must satisfy the configured schema constraint';
}

function decodeJsonPointerSegment(segment: string): string | null {
  if (/~(?:[^01]|$)/.test(segment)) return null;
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function resolveJsonPointer(
  root: JsonValue,
  pointer: string,
): { readonly found: true; readonly value: JsonValue } | { readonly found: false } | null {
  // Response Validator uses "/" as a safe root sentinel for Ajv's empty instancePath.
  if (pointer === '/') return { found: true, value: root };
  if (!pointer.startsWith('/')) return null;

  let current: JsonValue = root;
  for (const encodedSegment of pointer.slice(1).split('/')) {
    const segment = decodeJsonPointerSegment(encodedSegment);
    if (segment === null || current === null || typeof current !== 'object') {
      return null;
    }
    if (!Object.hasOwn(current, segment)) return { found: false };
    current = (current as Readonly<Record<string, JsonValue>>)[segment]!;
  }
  return { found: true, value: current };
}

function classifyValue(
  value: JsonValue,
): Exclude<StructuredOutputFoundType, 'MISSING' | 'UNKNOWN'> {
  if (value === null) return 'NULL';
  if (Array.isArray(value)) return 'ARRAY';

  switch (typeof value) {
    case 'string':
      return 'STRING';
    case 'boolean':
      return 'BOOLEAN';
    case 'number':
      return Number.isInteger(value) ? 'INTEGER' : 'NUMBER';
    default:
      return 'OBJECT';
  }
}

function foundType(value: JsonValue, instancePath: string): StructuredOutputFoundType {
  const resolved = resolveJsonPointer(value, instancePath);
  if (resolved === null) return 'UNKNOWN';
  if (!resolved.found) return 'MISSING';
  return classifyValue(resolved.value);
}

export function createStructuredOutputDiagnosticCollector(): StructuredOutputDiagnosticCollector {
  const issues: StructuredOutputDiagnosticIssue[] = [];

  return {
    capture(error, value, code) {
      try {
        const instancePath = schemaIssuePath(error);
        issues.push({
          code,
          instancePath,
          schemaPath: boundedTechnicalPath(error.schemaPath),
          keyword: error.keyword,
          sanitizedMessage: sanitizedAjvMessage(error),
          foundType: foundType(value, instancePath),
        });
      } catch {
        // Diagnostics are fail-open and can never alter the validation decision.
      }
    },

    buildReport(result) {
      if (issues.length === 0 || result.metadata.schemaHash === null) return null;

      return deepFreeze({
        diagnosticVersion: STRUCTURED_OUTPUT_DEBUG_VERSION,
        executionId: result.metadata.source.executionId,
        agentExecutionId: result.metadata.source.agentExecutionId,
        ...(result.metadata.source.requestId === undefined
          ? {}
          : { requestId: result.metadata.source.requestId }),
        ...(result.metadata.source.traceId === undefined
          ? {}
          : { traceId: result.metadata.source.traceId }),
        contract: {
          id: result.metadata.contract.id,
          version: result.metadata.contract.version,
          contractHash: result.metadata.contract.contractHash,
          schemaHash: result.metadata.schemaHash,
        },
        responseHash: result.metadata.source.responseHash,
        issueCount: issues.length,
        issuesTruncated: result.metadata.issuesTruncated,
        issues: [...issues],
      });
    },
  };
}

export function emitStructuredOutputDebugReport(
  reporter: StructuredOutputDebugReporter,
  collector: StructuredOutputDiagnosticCollector,
  result: ValidationResult,
): void {
  try {
    const report = collector.buildReport(result);
    if (report === null) return;

    const pending = reporter(report);
    if (pending !== undefined && typeof pending.then === 'function') {
      void Promise.resolve(pending).catch(() => undefined);
    }
  } catch {
    // A development reporter is observational and must remain fail-open.
  }
}
