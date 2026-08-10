const SAFE_TECHNICAL_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;

export function sanitizeTechnicalCode(value: unknown): string | null {
  return typeof value === 'string' && SAFE_TECHNICAL_CODE.test(value) ? value : null;
}
