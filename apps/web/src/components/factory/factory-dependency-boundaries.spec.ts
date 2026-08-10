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

function readFactorySource(factoryRoot: string, filename: string): string {
  return readFileSync(path.join(factoryRoot, filename), 'utf8');
}

function importedModules(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)].map(
    (match) => match[1]!,
  );
}

describe('Factory View frontend boundary', () => {
  const factoryRoot = path.resolve(process.cwd(), 'src/components/factory');
  const productionSource = productionFiles(factoryRoot)
    .map((filename) => readFileSync(filename, 'utf8'))
    .join('\n');
  const stylesheet = readFileSync(path.join(factoryRoot, 'factory.module.css'), 'utf8');
  const visualImplementationFiles = [
    'agent-visual-state.ts',
    'agent-avatar.tsx',
    'agent-station.tsx',
    'agent-connection.tsx',
    'factory-technical-pipeline.tsx',
    'factory-workspace.tsx',
  ] as const;
  const visualImplementationSource = visualImplementationFiles
    .map((filename) => readFactorySource(factoryRoot, filename))
    .join('\n');

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

  it('keeps the visual implementation isolated from backend and HTTP dependencies', () => {
    const imports = importedModules(visualImplementationSource);

    expect(imports).not.toContainEqual(expect.stringMatching(/^@brq\//));
    expect(imports).not.toContainEqual(expect.stringMatching(/^@\/(?:api|server|app\/api)\//));
    expect(imports).not.toContainEqual(expect.stringMatching(/(?:^|\/)(?:agents|core)(?:\/|$)/));
    expect(imports).not.toContainEqual(
      expect.stringMatching(/(?:ai-provider|prompt-builder|agent-runner|execution-client)/),
    );
    expect(visualImplementationSource).not.toMatch(/\bfetch\s*\(/);
  });

  it('derives visual states without introducing artificial timers or the reserved analyzing asset', () => {
    expect(visualImplementationSource).not.toMatch(
      /\b(?:setTimeout|setInterval|requestAnimationFrame)\b/,
    );
    expect(visualImplementationSource).not.toContain('02-analyzing.png');
  });

  it('keeps the existing 750 ms production poll as the only scheduler for live factory data', () => {
    const liveDataSource = readFactorySource(factoryRoot, 'use-factory-live-data.ts');
    const executionClientSource = readFileSync(
      path.resolve(process.cwd(), 'src/api/execution-client.ts'),
      'utf8',
    );

    expect(executionClientSource).toMatch(/export const EXECUTION_POLL_INTERVAL_MS\s*=\s*750\s*;/);
    expect(importedModules(liveDataSource)).toContain('@/api/execution-client');
    expect(liveDataSource).toContain('EXECUTION_POLL_INTERVAL_MS');
    expect(liveDataSource.match(/window\.setTimeout\s*\(/g)).toHaveLength(1);
    expect(liveDataSource).toMatch(
      /window\.setTimeout\([\s\S]*?},\s*EXECUTION_POLL_INTERVAL_MS\s*\);/,
    );
    expect(liveDataSource).not.toMatch(/\b(?:setInterval|requestAnimationFrame)\s*\(/);
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
