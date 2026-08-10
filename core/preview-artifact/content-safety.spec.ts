import { describe, expect, it } from 'vitest';

import { containsEvidentPreviewSecret, isWellFormedPreviewText } from './content-safety';

describe('Preview artifact content safety', () => {
  it('accepts valid Unicode and rejects controls or malformed surrogate pairs', () => {
    expect(isWellFormedPreviewText('Olá, Factory! 🚀')).toBe(true);
    expect(isWellFormedPreviewText('bad\u0000control')).toBe(false);
    expect(isWellFormedPreviewText('\ud800')).toBe(false);
    expect(isWellFormedPreviewText('\udc00')).toBe(false);
  });

  it('detects representative credential formats without exposing them', () => {
    expect(containsEvidentPreviewSecret('const token = "abcdefgh12345678"')).toBe(true);
    expect(containsEvidentPreviewSecret('-----BEGIN PRIVATE KEY-----')).toBe(true);
    expect(containsEvidentPreviewSecret(`const accessKey = "AKIA${'A'.repeat(16)}"`)).toBe(true);
    expect(containsEvidentPreviewSecret(`SLACK_TOKEN=xoxb-${'a'.repeat(24)}`)).toBe(true);
    expect(
      containsEvidentPreviewSecret(
        `authorization=eyJ${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`,
      ),
    ).toBe(true);
    expect(containsEvidentPreviewSecret(`Authorization: Bearer ${'z'.repeat(24)}`)).toBe(true);
    expect(
      containsEvidentPreviewSecret(
        'DATABASE_URL=postgresql://preview-user:synthetic-password@db.invalid/app',
      ),
    ).toBe(true);
    expect(containsEvidentPreviewSecret('API_TOKEN=synthetic_token_value_123')).toBe(true);
    expect(containsEvidentPreviewSecret('ordinary static application text')).toBe(false);
    expect(containsEvidentPreviewSecret('token count = 128')).toBe(false);
  });
});
