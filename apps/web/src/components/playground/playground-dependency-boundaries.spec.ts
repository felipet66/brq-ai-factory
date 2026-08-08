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

describe('Prompt Playground frontend boundary', () => {
  const playgroundRoot = path.resolve(process.cwd(), 'src/components/playground');
  const componentFiles = productionFiles(playgroundRoot);
  const componentSource = componentFiles
    .map((filename) => readFileSync(filename, 'utf8'))
    .join('\n');
  const clientSource = [
    path.resolve(process.cwd(), 'src/api/playground-client.ts'),
    path.resolve(process.cwd(), 'src/api/playground-contracts.ts'),
  ]
    .map((filename) => readFileSync(filename, 'utf8'))
    .join('\n');

  it('keeps browser components behind the minimized HTTP client boundary', () => {
    expect(componentSource).not.toMatch(/from ['"]@brq\//);
    expect(componentSource).not.toMatch(/from ['"]@\/server\//);
    expect(componentSource).not.toMatch(/from ['"]@\/app\/api\//);
    expect(componentSource).not.toMatch(/from ['"][^'"]*(?:core|agents)\//);
    expect(componentSource).not.toMatch(/\bfetch\s*\(/);
    expect(clientSource).not.toMatch(/from ['"]@brq\//);
    expect(clientSource).not.toMatch(/from ['"]@\/server\//);
  });

  it('has one explicit client entry and no unsafe rendering or persistence surface', () => {
    const clientEntries = componentFiles
      .filter((filename) => readFileSync(filename, 'utf8').startsWith("'use client';"))
      .map((filename) => path.basename(filename));

    expect(clientEntries).toEqual(['playground-experience.tsx']);
    expect(componentSource).not.toContain('dangerouslySetInnerHTML');
    expect(componentSource).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB)\b/);
    expect(componentSource).not.toMatch(/document\.cookie/);
    expect(componentSource).not.toMatch(/\bconsole\.(?:log|info|warn|error|debug)\b/);
    expect(clientSource).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB)\b/);
    expect(clientSource).not.toMatch(/document\.cookie/);
    expect(clientSource).not.toMatch(/\bconsole\.(?:log|info|warn|error|debug)\b/);
  });

  it('keeps the page server-guarded for authenticated ADMIN access', () => {
    const page = readFileSync(path.resolve(process.cwd(), 'src/app/playground/page.tsx'), 'utf8');

    expect(page).toContain('await requireAuthenticatedUser()');
    expect(page).toContain("currentUser.role !== 'ADMIN'");
    expect(page).toContain('notFound()');
  });
});
