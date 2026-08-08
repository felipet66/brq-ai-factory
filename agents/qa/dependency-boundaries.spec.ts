import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));
const QA_PROMPT_ROOT = resolve(MODULE_ROOT, '../../prompts/qa');
const CORE_ENTRYPOINTS = [
  'agent-runner',
  'artifact-generator',
  'knowledge-loader',
  'prompt-builder',
  'response-validator',
] as const;

function productionTypeScriptFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === 'testing' ? [] : productionTypeScriptFiles(path);
    }

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

function leavesApprovedModuleRoots(importingFile: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const target = resolve(dirname(importingFile), specifier);
  return !isWithin(MODULE_ROOT, target) && !isWithin(QA_PROMPT_ROOT, target);
}

describe('QA Agent dependency boundaries', () => {
  it('uses only public core entrypoints and never reaches forbidden layers or adapters', () => {
    const files = productionTypeScriptFiles(MODULE_ROOT);
    const sources = files.map((path) => ({ path, source: readFileSync(path, 'utf8') }));
    const violations: string[] = [];

    for (const { path, source } of sources) {
      for (const specifier of importedSpecifiers(source)) {
        if (
          /^@brq\/(?:ai-provider|prisma)(?:\/|$)/.test(specifier) ||
          leavesApprovedModuleRoots(path, specifier) ||
          /(?:^|\/)(?:apps|prisma|repositories|orchestrator|execution-engine)(?:\/|$)/.test(
            specifier,
          ) ||
          /^node:(?:fs|child_process|net|http|https)(?:\/|$)/.test(specifier) ||
          CORE_ENTRYPOINTS.some((entrypoint) => specifier.startsWith(`@brq/${entrypoint}/`))
        ) {
          violations.push(`${path}: ${specifier}`);
        }
      }
    }

    const source = sources.map(({ source: fileSource }) => fileSource).join('\n');
    expect(violations).toEqual([]);
    expect(source).not.toMatch(/\b(?:PrismaClient|ArtifactRepository|AIProvider|OpenAIProvider)\b/);
    expect(source).not.toMatch(/\b(?:fetch|writeFile|mkdir|createNextVersion)\s*\(/);
  });

  it('recognizes static, side-effect and dynamic imports when enforcing boundaries', () => {
    expect(
      importedSpecifiers(`
        import value from '@brq/agent-runner';
        export { value } from '@brq/shared';
        import '@brq/ai-provider/openai';
        const module = import('../../core/ai-provider/openai/openai-provider');
      `),
    ).toEqual([
      '@brq/agent-runner',
      '@brq/shared',
      '@brq/ai-provider/openai',
      '../../core/ai-provider/openai/openai-provider',
    ]);
  });

  it('depends on upstream agent packages only through their public contracts and pure validation', () => {
    const files = productionTypeScriptFiles(MODULE_ROOT);
    const productOwnerImports = files.flatMap((path) =>
      importedSpecifiers(readFileSync(path, 'utf8')).filter((specifier) =>
        specifier.startsWith('@brq/product-owner-agent'),
      ),
    );
    const source = files.map((path) => readFileSync(path, 'utf8')).join('\n');

    expect(productOwnerImports).toEqual(['@brq/product-owner-agent']);
    expect(source).not.toMatch(/\bcreateProductOwnerAgent\b/);
    expect(source).not.toMatch(/\bloadProductOwnerPromptAssets\b/);
    const developerImports = files.flatMap((path) =>
      importedSpecifiers(readFileSync(path, 'utf8')).filter((specifier) =>
        specifier.startsWith('@brq/developer-agent'),
      ),
    );
    expect(developerImports).toEqual(['@brq/developer-agent', '@brq/developer-agent']);
    expect(source).not.toMatch(/\bcreateDeveloperAgent\b/);
    expect(source).not.toMatch(/\bloadDeveloperPromptAssets\b/);
  });

  it('keeps Prompt Builder access narrow and does not duplicate canonical hashing', () => {
    const files = productionTypeScriptFiles(MODULE_ROOT);
    const source = files.map((path) => readFileSync(path, 'utf8')).join('\n');
    const facade = readFileSync(join(MODULE_ROOT, 'qa-agent.ts'), 'utf8');
    const filenames = files.map((path) => path.slice(MODULE_ROOT.length + 1));

    expect(source).not.toMatch(/\b(?:createPromptBuilder|PromptBuilder)\b/);
    expect(source).not.toMatch(/\.build\s*\(/);
    expect(facade).not.toContain('@brq/prompt-builder');
    expect(facade).not.toContain('@brq/ai-provider');
    expect(source).not.toContain("from 'node:crypto'");
    expect(source).not.toMatch(/function\s+(?:canonicalizeJson|calculateCanonicalJsonHash)\b/);
    expect(filenames).not.toContain('canonical-json.ts');
    expect(filenames).not.toContain('hashing.ts');
  });

  it('declares only the approved workspace and schema dependencies', () => {
    const packageJson = JSON.parse(readFileSync(join(MODULE_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      exports: Record<string, string>;
    };

    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      '@brq/agent-runner',
      '@brq/artifact-generator',
      '@brq/developer-agent',
      '@brq/knowledge-loader',
      '@brq/product-owner-agent',
      '@brq/prompt-builder',
      '@brq/response-validator',
      '@brq/shared',
      'zod',
    ]);
    expect(packageJson.exports).toEqual({ '.': './index.ts' });
  });

  it('exposes only the approved pure inspection projection and no deep imports', () => {
    const tsconfig = JSON.parse(
      readFileSync(join(MODULE_ROOT, '..', '..', 'tsconfig.base.json'), 'utf8'),
    ) as { compilerOptions?: { paths?: Record<string, readonly string[]> } };
    const publicIndex = readFileSync(join(MODULE_ROOT, 'index.ts'), 'utf8');

    expect(tsconfig.compilerOptions?.paths?.['@brq/qa-agent/*']).toBeUndefined();
    expect(publicIndex).not.toContain('deepFreeze');
    expect(publicIndex).toContain(
      "export { projectQAPromptContexts } from './knowledge-projection';",
    );
    expect(publicIndex).not.toContain('createQAAgentRunRequest');
    expect(publicIndex).not.toContain('createGeneratedResult');
    expect(publicIndex).not.toContain('requestLogContext');
  });
});
