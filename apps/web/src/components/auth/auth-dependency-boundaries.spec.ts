// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(absolute);
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.includes('.spec.') ? [absolute] : [];
  });
}

describe('authentication presentation boundary', () => {
  const source = productionFiles(path.resolve(process.cwd(), 'src/components/auth'))
    .map((filename) => readFileSync(filename, 'utf8'))
    .join('\n');

  it('depends only on the minimized auth client and public user contract', () => {
    expect(source).not.toMatch(/from ['"]@brq\//);
    expect(source).not.toMatch(/from ['"]@\/server\//);
    expect(source).not.toMatch(/from ['"]@\/app\/api\//);
    expect(source).not.toMatch(/from ['"][^'"]*(?:core|agents|prisma)\//);
  });

  it('never handles transport or browser-managed session material directly', () => {
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\b(?:localStorage|sessionStorage)\b/);
    expect(source).not.toContain('dangerouslySetInnerHTML');
    expect(source).not.toMatch(/document\.cookie/);
  });
});
