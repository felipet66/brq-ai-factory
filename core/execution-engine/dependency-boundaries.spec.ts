import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));

function productionTypeScriptFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'testing' ? [] : productionTypeScriptFiles(path);
    return extname(entry.name) === '.ts' && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

function importedSpecifiers(source: string): readonly string[] {
  return [
    ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
  ].map((match) => match[1]!);
}

function leavesModule(importingFile: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const target = resolve(dirname(importingFile), specifier);
  const relativePath = relative(MODULE_ROOT, target);
  return relativePath.startsWith('..') || isAbsolute(relativePath);
}

describe('Execution Engine dependency boundaries', () => {
  it('depende funcionalmente apenas do entrypoint público do Orchestrator', () => {
    const violations: string[] = [];
    for (const path of productionTypeScriptFiles(MODULE_ROOT)) {
      for (const specifier of importedSpecifiers(readFileSync(path, 'utf8'))) {
        if (
          leavesModule(path, specifier) ||
          /^@brq\/orchestrator\//.test(specifier) ||
          /^@brq\/(?:product-owner-agent|developer-agent|qa-agent|agent-runner|ai-provider|artifact-generator|knowledge-loader|prompt-builder|response-validator|prisma)(?:\/|$)/.test(
            specifier,
          ) ||
          /(?:^|\/)(?:agents|apps|prisma|repositories)(?:\/|$)/.test(specifier) ||
          /^node:(?:fs|child_process|net|http|https)(?:\/|$)/.test(specifier)
        ) {
          violations.push(`${path}: ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('não implementa agentes, persistência, retry, filas, concorrência ou geração aleatória', () => {
    const source = productionTypeScriptFiles(MODULE_ROOT)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(
      /\b(?:ProductOwnerAgent|DeveloperAgent|QAAgent|AIProvider|PromptBuilder|ArtifactGenerator|ResponseValidator|KnowledgeLoader|PrismaClient)\b/,
    );
    expect(source).not.toMatch(/\b(?:fetch|writeFile|mkdir|setTimeout|setInterval)\s*\(/);
    expect(source).not.toMatch(/\b(?:Math\.random|Date\.now|randomUUID)\s*\(/);
    expect(source).not.toMatch(/\b(?:retry|backoff|scheduler|worker|queue)\b/i);
  });

  it('declara somente dependências aprovadas e um único entrypoint', () => {
    const packageJson = JSON.parse(readFileSync(join(MODULE_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      exports: Record<string, string>;
    };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      '@brq/orchestrator',
      '@brq/shared',
      'zod',
    ]);
    expect(packageJson.exports).toEqual({ '.': './index.ts' });
  });

  it('não cria alias público para deep imports', () => {
    const tsconfig = JSON.parse(
      readFileSync(join(MODULE_ROOT, '..', '..', 'tsconfig.base.json'), 'utf8'),
    ) as { compilerOptions?: { paths?: Record<string, readonly string[]> } };
    expect(tsconfig.compilerOptions?.paths?.['@brq/execution-engine/*']).toBeUndefined();
  });
});
