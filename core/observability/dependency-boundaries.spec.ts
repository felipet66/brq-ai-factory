import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));

function productionFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'testing' ? [] : productionFiles(path);
    return extname(entry.name) === '.ts' && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

function imports(source: string): readonly string[] {
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!);
}

describe('Observability dependency boundaries', () => {
  it('depende apenas das APIs públicas do Engine e Shared', () => {
    const violations: string[] = [];
    for (const path of productionFiles(MODULE_ROOT)) {
      for (const specifier of imports(readFileSync(path, 'utf8'))) {
        const target = specifier.startsWith('.') ? resolve(dirname(path), specifier) : null;
        const leavesModule =
          target !== null &&
          (relative(MODULE_ROOT, target).startsWith('..') ||
            isAbsolute(relative(MODULE_ROOT, target)));
        if (
          leavesModule ||
          /^@brq\/(?:orchestrator|product-owner-agent|developer-agent|qa-agent|agent-runner|ai-provider|artifact-generator|knowledge-loader|prompt-builder|response-validator|prisma)(?:\/|$)/.test(
            specifier,
          ) ||
          /^@brq\/execution-engine\//.test(specifier)
        ) {
          violations.push(`${path}: ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('não contém persistência, transporte ou schedulers', () => {
    const source = productionFiles(MODULE_ROOT)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/\b(?:PrismaClient|Redis|Kafka|RabbitMQ|WebSocket|EventSource)\b/);
    expect(source).not.toMatch(/\b(?:setInterval|setTimeout|fetch|writeFile|mkdir)\s*\(/);
  });

  it('declara apenas dependências aprovadas e um entrypoint', () => {
    const packageJson = JSON.parse(readFileSync(join(MODULE_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      exports: Record<string, string>;
    };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      '@brq/execution-engine',
      '@brq/shared',
      'zod',
    ]);
    expect(packageJson.exports).toEqual({ '.': './index.ts' });
  });
});
