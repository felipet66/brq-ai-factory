export interface PublicTypeScriptDiagnosticSummary {
  readonly diagnosticCount: number;
  readonly diagnosticCodes: readonly number[];
  readonly truncated: boolean;
}

export function safePublicTypeScriptDiagnosticSummary(
  value: unknown,
): PublicTypeScriptDiagnosticSummary | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !['diagnosticCount', 'diagnosticCodes', 'truncated'].includes(key),
    ) ||
    !Number.isInteger(record.diagnosticCount) ||
    (record.diagnosticCount as number) < 1 ||
    (record.diagnosticCount as number) > 10_000 ||
    !Array.isArray(record.diagnosticCodes) ||
    record.diagnosticCodes.length < 1 ||
    record.diagnosticCodes.length > 32 ||
    record.diagnosticCodes.length > (record.diagnosticCount as number) ||
    typeof record.truncated !== 'boolean'
  ) {
    return null;
  }
  const diagnosticCodes = record.diagnosticCodes;
  if (
    !diagnosticCodes.every(
      (code, index) =>
        Number.isInteger(code) &&
        code >= 1 &&
        code <= 99_999 &&
        (index === 0 || code > diagnosticCodes[index - 1]!),
    )
  ) {
    return null;
  }
  return Object.freeze({
    diagnosticCount: record.diagnosticCount as number,
    diagnosticCodes: Object.freeze([...diagnosticCodes] as number[]),
    truncated: record.truncated,
  });
}
