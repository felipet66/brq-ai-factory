// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(absolute);
    const productionSource = /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.includes('.spec.');
    return productionSource ? [absolute] : [];
  });
}

function sourceOf(files: readonly string[]): string {
  return files.map((filename) => readFileSync(filename, 'utf8')).join('\n');
}

describe('Frontend dependency boundary', () => {
  const apiRoot = path.resolve(process.cwd(), 'src/api');
  const componentsRoot = path.resolve(process.cwd(), 'src/components/execution');
  const configRoot = path.resolve(process.cwd(), 'src/config');
  const browserFiles = [
    ...productionFiles(apiRoot),
    ...productionFiles(componentsRoot),
    ...productionFiles(configRoot),
    path.resolve(process.cwd(), 'src/app/page.tsx'),
  ];
  const componentFiles = productionFiles(componentsRoot);
  const frontendSource = sourceOf([
    path.resolve(process.cwd(), 'src/app/page.tsx'),
    ...componentFiles,
  ]);
  const browserSource = sourceOf(browserFiles);

  it('depends only on the HTTP client projection', () => {
    expect(browserSource).not.toMatch(/from ['"]@brq\//);
    expect(browserSource).not.toMatch(/from ['"]@\/server\//);
    expect(browserSource).not.toMatch(/from ['"]@\/app\/api\//);
    expect(browserSource).not.toMatch(/from ['"][^'"]*(?:core|agents)\//);
    expect(frontendSource).not.toMatch(
      /\.(?:workflowResult|specification|artifacts)\b|\[['"](?:workflowResult|specification|artifacts)['"]\]/,
    );

    const presentationContractImports = [
      ...frontendSource.matchAll(
        /import type \{([^}]*)\} from ['"]@\/api\/execution-contracts['"]/g,
      ),
    ];
    expect(presentationContractImports.length).toBeGreaterThan(0);
    for (const contractImport of presentationContractImports) {
      const importedContracts = contractImport[1]
        ?.split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      for (const importedContract of importedContracts ?? []) {
        expect(importedContract).toMatch(
          /^(?:ExecutionSummary|ExecutionJobStatus|ExecutionJobView)$/,
        );
      }
    }
  });

  it('keeps HTTP and unsafe HTML outside React components', () => {
    expect(frontendSource).not.toMatch(/\bfetch\s*\(/);
    expect(frontendSource).not.toContain('dangerouslySetInnerHTML');
  });

  it('has exactly one explicit client entry point', () => {
    const clientEntries = componentFiles.filter((filename) =>
      readFileSync(filename, 'utf8').startsWith("'use client';"),
    );

    expect(clientEntries.map((filename) => path.basename(filename))).toEqual([
      'execution-experience.tsx',
    ]);
  });
});
