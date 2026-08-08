import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));
const PROMPT_ROOT = resolve(MODULE_ROOT, '../../prompts/code-generator');
const APPROVED_BARE_SPECIFIERS = new Set([
  '@brq/agent-runner',
  '@brq/developer-agent',
  '@brq/knowledge-loader',
  '@brq/prompt-builder',
  '@brq/response-validator',
  '@brq/shared/logger/logger',
  '@brq/shared/schemas/common.schema',
  '@brq/shared/types/json-value',
  'node:buffer',
  'node:path',
  'zod',
]);

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

function isWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function leavesApprovedRoots(importingFile: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const target = resolve(dirname(importingFile), specifier);
  return !isWithin(MODULE_ROOT, target) && !isWithin(PROMPT_ROOT, target);
}

function isApprovedBareSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || APPROVED_BARE_SPECIFIERS.has(specifier);
}

describe('Code Generator dependency boundaries', () => {
  it('uses only approved public APIs and has no filesystem, provider or execution dependency', () => {
    const files = productionTypeScriptFiles(MODULE_ROOT);
    const sources = files.map((path) => ({ path, source: readFileSync(path, 'utf8') }));
    const violations: string[] = [];
    for (const { path, source } of sources) {
      for (const specifier of importedSpecifiers(source)) {
        if (
          !isApprovedBareSpecifier(specifier) ||
          leavesApprovedRoots(path, specifier) ||
          /(?:^|\/)(?:apps|prisma|repositories)(?:\/|$)/.test(specifier) ||
          /^node:(?:fs|child_process|net|http|https)(?:\/|$)/.test(specifier)
        ) {
          violations.push(`${path}: ${specifier}`);
        }
      }
    }
    const source = sources.map((entry) => entry.source).join('\n');
    expect(violations).toEqual([]);
    expect(source).not.toMatch(/\b(?:AIProvider|OpenAIProvider|ArtifactGenerator|PrismaClient)\b/);
    expect(source).not.toMatch(/\b(?:fetch|writeFile|mkdir|spawn|exec)\s*\(/);
  });

  it.each([
    '@brq/job-queue',
    '@brq/execution-worker',
    '@brq/controlled-workspace',
    '@brq/ai-provider',
    '@brq/agent-runner/internal',
    '@brq/shared/internal/private',
    'openai',
    'axios',
  ])('rejects non-allowlisted bare specifier %s', (specifier) => {
    expect(isApprovedBareSpecifier(specifier)).toBe(false);
  });

  it('consumes Developer only through its package root without executing that agent', () => {
    const files = productionTypeScriptFiles(MODULE_ROOT);
    const imports = files.flatMap((path) =>
      importedSpecifiers(readFileSync(path, 'utf8')).filter((specifier) =>
        specifier.startsWith('@brq/developer-agent'),
      ),
    );
    const source = files.map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(imports.length).toBeGreaterThan(0);
    expect(new Set(imports)).toEqual(new Set(['@brq/developer-agent']));
    expect(source).not.toMatch(/\b(?:createDeveloperAgent|loadDeveloperPromptAssets)\b/);
  });

  it('keeps generic builders and all assembly internals outside the public facade', () => {
    const files = productionTypeScriptFiles(MODULE_ROOT);
    const source = files.map((path) => readFileSync(path, 'utf8')).join('\n');
    const publicIndex = readFileSync(join(MODULE_ROOT, 'index.ts'), 'utf8');
    expect(source).not.toMatch(/\b(?:createPromptBuilder|PromptBuilder)\b/);
    expect(source).not.toContain("from 'node:crypto'");
    expect(publicIndex).toContain('projectCodeGeneratorPromptContexts');
    expect(publicIndex).not.toContain('assembleGeneratedCodeBundle');
    expect(publicIndex).not.toContain('createCodeGeneratorAgentRunRequest');
    expect(publicIndex).not.toContain('createGeneratedResult');
    expect(publicIndex).not.toContain('requestLogContext');
    expect(publicIndex).not.toContain('deepFreeze');
  });

  it('declares only approved workspace dependencies and the root export', () => {
    const packageJson = JSON.parse(readFileSync(join(MODULE_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      exports: Record<string, string>;
    };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      '@brq/agent-runner',
      '@brq/developer-agent',
      '@brq/knowledge-loader',
      '@brq/prompt-builder',
      '@brq/response-validator',
      '@brq/shared',
      'zod',
    ]);
    expect(packageJson.exports).toEqual({ '.': './index.ts' });
  });
});
