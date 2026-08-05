import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'testing' ? [] : productionTypeScriptFiles(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('Artifact Generator dependency boundaries', () => {
  it('does not import providers, runners, prompts, agents, persistence or I/O adapters', () => {
    const source = productionTypeScriptFiles(MODULE_ROOT)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');

    expect(source).not.toMatch(
      /from ['"]@brq\/(?:agent-runner|ai-provider|prompt-builder|knowledge-loader|prisma)/,
    );
    expect(source).not.toMatch(/from ['"].*(?:orchestrator|agents\/|apps\/)/);
    expect(source).not.toMatch(/from ['"]node:(?:fs|child_process|net|http|https)/);
    expect(source).not.toMatch(/\b(?:eval|Function)\s*\(/);
    expect(source).not.toMatch(/\b(?:fetch|writeFile|mkdir|createNextVersion)\s*\(/);
    expect(source).not.toContain('ArtifactRepository');
    expect(source).not.toContain('Prisma');
  });

  it('declares only the approved workspace dependencies', () => {
    const packageJson = JSON.parse(readFileSync(join(MODULE_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      exports: Record<string, string>;
    };

    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      '@brq/response-validator',
      '@brq/shared',
      'zod',
    ]);
    expect(packageJson.exports).toEqual({ '.': './index.ts' });
  });

  it('does not expose deep imports through a TypeScript path alias', () => {
    const tsconfig = JSON.parse(
      readFileSync(join(MODULE_ROOT, '..', '..', 'tsconfig.base.json'), 'utf8'),
    ) as { compilerOptions?: { paths?: Record<string, readonly string[]> } };

    expect(tsconfig.compilerOptions?.paths?.['@brq/artifact-generator/*']).toBeUndefined();
  });

  it('keeps the resolved model internal and the renderer isolated from requests and bindings', () => {
    const publicIndex = readFileSync(join(MODULE_ROOT, 'index.ts'), 'utf8');
    const renderer = readFileSync(join(MODULE_ROOT, 'rendering.ts'), 'utf8');

    expect(publicIndex).not.toContain('ResolvedArtifactModel');
    expect(publicIndex).not.toContain('resolveArtifactModel');
    expect(publicIndex).not.toContain('renderResolvedArtifact');
    expect(renderer).not.toContain('ValidationResult');
    expect(renderer).not.toContain('ArtifactGenerationRequest');
    expect(renderer).not.toContain('BindingPath');
    expect(renderer).not.toContain('resolvePath');
  });
});
