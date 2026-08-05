import { jsonValueSchema } from '@brq/shared/schemas/json-value.schema';
import type { JsonValue } from '@brq/shared/types/json-value';

import type { ReadonlyJsonValue } from '../canonical-json';
import type { ResponseValidatorConfiguration } from '../configuration';
import {
  contentMissingIssue,
  contentNestingTooDeepIssue,
  contentTooLargeIssue,
  finishReasonIssue,
  malformedJsonIssue,
} from '../issues';
import { utf8ByteLength } from '../hashing';
import { addIssue, halt, type ValidationReport } from './validation-report';

export function nestingDepth(value: ReadonlyJsonValue): number {
  let maximum = 0;
  const pending: { value: ReadonlyJsonValue; depth: number }[] = [{ value, depth: 0 }];

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.value === null || typeof current.value !== 'object') continue;

    const depth = current.depth + 1;
    maximum = Math.max(maximum, depth);

    const children = Array.isArray(current.value) ? current.value : Object.values(current.value);
    for (const child of children) pending.push({ value: child as ReadonlyJsonValue, depth });
  }

  return maximum;
}

export function validateContent(
  report: ValidationReport,
  configuration: ResponseValidatorConfiguration,
): void {
  const { output } = report.request.runResult;

  if (output.finishReason !== 'COMPLETED') {
    addIssue(report, finishReasonIssue(output.finishReason));
    halt(report);
    return;
  }

  if (utf8ByteLength(output.content) > configuration.maxContentBytes) {
    addIssue(report, contentTooLargeIssue());
    halt(report);
    return;
  }

  if (output.content.trim().length === 0) {
    addIssue(report, contentMissingIssue());
    halt(report);
    return;
  }

  if (report.request.contract.format === 'TEXT') return;

  let parsed: JsonValue;
  try {
    parsed = JSON.parse(output.content) as JsonValue;
  } catch {
    addIssue(report, malformedJsonIssue());
    halt(report);
    return;
  }

  if (nestingDepth(parsed) > configuration.maxNestingDepth) {
    addIssue(report, contentNestingTooDeepIssue());
    halt(report);
    return;
  }

  const jsonValue = jsonValueSchema.safeParse(parsed);
  if (!jsonValue.success) {
    addIssue(report, malformedJsonIssue());
    halt(report);
    return;
  }

  report.parsedValue = jsonValue.data;
}
