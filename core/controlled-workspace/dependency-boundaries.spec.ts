import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('controlled workspace dependency boundary', () => {
  async function productionTypeScriptFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'testing' || entry.name === 'node_modules') continue;
        files.push(...(await productionTypeScriptFiles(`${directory}/${entry.name}`)));
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        files.push(`${directory}/${entry.name}`);
      }
    }
    return files.sort();
  }

  it('does not depend on agents or generation implementations', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('./package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string>; exports: Record<string, string> };
    expect(Object.keys(packageJson.dependencies)).toEqual(['@brq/shared', 'zod']);
    expect(packageJson.exports).toEqual({
      '.': './index.ts',
      './filesystem': './filesystem/filesystem-controlled-workspace.ts',
      './testing': './testing/index.ts',
    });
  });

  it('recursively enforces the production import and capability allowlist', async () => {
    const workspaceRoot = fileURLToPath(new URL('.', import.meta.url));
    const files = await productionTypeScriptFiles(workspaceRoot);
    const allowedExternalImports = new Set([
      '@brq/shared/logger/logger',
      'node:buffer',
      'node:crypto',
      'node:fs',
      'node:fs/promises',
      'node:path',
      'zod',
    ]);

    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(
        /agents\/|@brq\/(?:agent-runner|ai-provider|code-generator|execution-engine|orchestrator|prompt-builder)/u,
      );
      expect(source, file).not.toMatch(
        /node:(?:child_process|net|http|https)|\bfetch\s*\(|\bspawn\s*\(|\bexec\s*\(/u,
      );

      for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/gu)) {
        const specifier = match[1];
        if (specifier === undefined || specifier.startsWith('.')) continue;
        expect(allowedExternalImports.has(specifier), `${file}: ${specifier}`).toBe(true);
      }
    }
  });
});
