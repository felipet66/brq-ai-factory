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

describe('Factory View frontend boundary', () => {
  const factoryRoot = path.resolve(process.cwd(), 'src/components/factory');
  const productionSource = productionFiles(factoryRoot)
    .map((filename) => readFileSync(filename, 'utf8'))
    .join('\n');
  const stylesheet = readFileSync(path.join(factoryRoot, 'factory.module.css'), 'utf8');

  it('depends only on public browser clients and the FactoryViewModel', () => {
    expect(productionSource).not.toMatch(/from ['"]@brq\//);
    expect(productionSource).not.toMatch(/from ['"]@\/server\//);
    expect(productionSource).not.toMatch(/from ['"]@\/app\/api\//);
    expect(productionSource).not.toMatch(/from ['"][^'"]*(?:core|agents)\//);
    expect(productionSource).not.toMatch(/\bfetch\s*\(/);
    expect(productionSource).not.toContain('dangerouslySetInnerHTML');
  });

  it('does not create a sensitive browser persistence or diagnostic surface', () => {
    expect(productionSource).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB)\b/);
    expect(productionSource).not.toMatch(/document\.cookie/);
    expect(productionSource).not.toMatch(/\bconsole\.(?:log|info|warn|error|debug)\b/);
    expect(productionSource).not.toMatch(/\b(?:knowledgeContent|rawResponse|artifactContent)\b/);
    expect(productionSource).not.toContain('OPENAI_API_KEY');
  });

  it('contains explicit mobile reflow, state selectors and reduced-motion protection', () => {
    expect(stylesheet).toContain('@media (max-width: 63.99rem)');
    expect(stylesheet).toContain('@media (max-width: 42rem)');
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)');
    expect(stylesheet).toContain("[data-state='WORKING']");
    expect(stylesheet).toContain("[data-state='FAILED']");
    expect(stylesheet).toContain("[data-state='COMPLETED']");
  });
});
