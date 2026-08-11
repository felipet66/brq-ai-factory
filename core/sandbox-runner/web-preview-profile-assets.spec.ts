import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  FACTORY_EXECUTION_PROFILE_REASON_CODES as REASONS,
  FACTORY_EXECUTION_PROFILE_RULE_IDS as RULES,
  NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE as EXECUTION_PROFILE,
  createFactoryExecutionProfileValidator,
  projectGenerationProfileConstraints,
  type ExecutionProfileBundleFile,
} from '@brq/factory-execution-profile';
import { describe, expect, it } from 'vitest';

const FACTORY_PROFILE_ROOT = path.resolve(process.cwd(), 'apps/web/docker/factory-web-preview');
const PREVIEW_RUNTIME_ROOT = path.resolve(process.cwd(), 'apps/web/docker/preview-runner');

function profileFile(root: string, relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8');
}

interface FactoryWebPreviewHelper {
  mediaTypeFor(filePath: string): string;
  sourcePathsFromManifest(manifest: {
    readonly files: readonly { readonly path: string }[];
  }): readonly string[];
  testPathsFromSources(sources: readonly string[]): readonly string[];
  validateExecutionProfileFiles(
    files: readonly {
      readonly path: string;
      readonly mediaType?: string;
      readonly content: Buffer;
    }[],
  ): unknown;
  validateOptionalPackage(content: Buffer): void;
  validatePreviewSource(filePath: string, content: Buffer): void;
}

interface ParityFixture {
  readonly name: string;
  readonly ruleId: string;
  readonly reasonCode: string;
  readonly invalidFiles: () => readonly ExecutionProfileBundleFile[];
}

function baseFiles(): readonly ExecutionProfileBundleFile[] {
  return [
    {
      path: 'index.html',
      mediaType: 'text/html',
      content: '<script type="module" src="./src/app.js"></script>',
    },
    {
      path: 'src/app.test.ts',
      mediaType: 'text/typescript',
      content:
        "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { value } from './app.js';\ntest('value', () => assert.equal(value, 1));\n",
    },
    {
      path: 'src/app.ts',
      mediaType: 'text/typescript',
      content: 'export const value = 1;\n',
    },
  ];
}

function replaceFile(
  filePath: string,
  content: string,
  files = baseFiles(),
): readonly ExecutionProfileBundleFile[] {
  return files.map((file) => (file.path === filePath ? { ...file, content } : file));
}

function addFile(file: ExecutionProfileBundleFile): readonly ExecutionProfileBundleFile[] {
  return [...baseFiles(), file];
}

const PARITY_MATRIX: readonly ParityFixture[] = [
  {
    name: 'source required',
    ruleId: RULES.SOURCE_REQUIRED,
    reasonCode: REASONS.NO_SUPPORTED_SOURCE,
    invalidFiles: () => baseFiles().filter((file) => !file.path.endsWith('.ts')),
  },
  {
    name: 'test required',
    ruleId: RULES.TEST_REQUIRED,
    reasonCode: REASONS.NO_TEST_FILES,
    invalidFiles: () => baseFiles().filter((file) => !file.path.includes('.test.')),
  },
  {
    name: 'index required',
    ruleId: RULES.REQUIRED_FILES,
    reasonCode: REASONS.INDEX_HTML_REQUIRED,
    invalidFiles: () => baseFiles().filter((file) => file.path !== 'index.html'),
  },
  ...['.jsx', '.tsx'].map((extension): ParityFixture => ({
    name: `${extension} forbidden`,
    ruleId: RULES.FILES,
    reasonCode: REASONS.UNSUPPORTED_SOURCE_PROFILE,
    invalidFiles: () =>
      addFile({
        path: `src/component${extension}`,
        mediaType: extension === '.jsx' ? 'text/javascript' : 'text/typescript',
        content: 'export const Component = () => null;\n',
      }),
  })),
  {
    name: 'media type mismatch',
    ruleId: RULES.FILES,
    reasonCode: REASONS.UNSUPPORTED_SOURCE_PROFILE,
    invalidFiles: () =>
      baseFiles().map((file) =>
        file.path === 'index.html' ? { ...file, mediaType: 'text/plain' } : file,
      ),
  },
  {
    name: 'inline script',
    ruleId: RULES.HTML_INLINE_ACTIVE,
    reasonCode: REASONS.INLINE_ACTIVE_CONTENT,
    invalidFiles: () => replaceFile('index.html', '<script>alert(1)</script>'),
  },
  {
    name: 'inline style element',
    ruleId: RULES.HTML_INLINE_ACTIVE,
    reasonCode: REASONS.INLINE_ACTIVE_CONTENT,
    invalidFiles: () => replaceFile('index.html', '<style>body{color:red}</style>'),
  },
  {
    name: 'style attribute',
    ruleId: RULES.HTML_INLINE_ACTIVE,
    reasonCode: REASONS.INLINE_ACTIVE_CONTENT,
    invalidFiles: () => replaceFile('index.html', '<main style="color:red"></main>'),
  },
  {
    name: 'event handler attribute',
    ruleId: RULES.HTML_INLINE_ACTIVE,
    reasonCode: REASONS.INLINE_ACTIVE_CONTENT,
    invalidFiles: () => replaceFile('index.html', '<button onclick="run()">Run</button>'),
  },
  {
    name: 'external URL',
    ruleId: RULES.HTML_REFERENCES,
    reasonCode: REASONS.EXTERNAL_OR_UNSAFE_REFERENCE,
    invalidFiles: () =>
      replaceFile('index.html', '<script src="https://example.com/app.js"></script>'),
  },
  ...['iframe', 'form', 'object'].map((element): ParityFixture => ({
    name: `${element} element`,
    ruleId: RULES.HTML_ELEMENTS,
    reasonCode: REASONS.UNSUPPORTED_HTML,
    invalidFiles: () => replaceFile('index.html', `<${element}></${element}>`),
  })),
  {
    name: 'CSS import',
    ruleId: RULES.CSS_IMPORT,
    reasonCode: REASONS.UNSUPPORTED_CSS,
    invalidFiles: () =>
      addFile({ path: 'styles.css', mediaType: 'text/css', content: '@import "./theme.css";' }),
  },
  {
    name: 'external CSS URL',
    ruleId: RULES.CSS_URLS,
    reasonCode: REASONS.EXTERNAL_OR_UNSAFE_REFERENCE,
    invalidFiles: () =>
      addFile({
        path: 'styles.css',
        mediaType: 'text/css',
        content: 'body{background:url(https://example.com/a.png)}',
      }),
  },
  ...[
    ['WebSocket', 'new WebSocket("wss://example.com")'],
    ['Worker', 'new Worker("./worker.js")'],
    ['service worker', 'navigator.serviceWorker.register("./sw.js")'],
  ].map(([name, content]): ParityFixture => ({
    name: name!,
    ruleId: RULES.JAVASCRIPT_CAPABILITIES,
    reasonCode: REASONS.UNSUPPORTED_BROWSER_CAPABILITY,
    invalidFiles: () => replaceFile('src/app.ts', content!),
  })),
  {
    name: 'invalid JSON',
    ruleId: RULES.JSON_VALID,
    reasonCode: REASONS.INVALID_JSON,
    invalidFiles: () =>
      addFile({ path: 'config.json', mediaType: 'application/json', content: '{invalid' }),
  },
  ...[
    ['package scripts', '{"type":"module","scripts":{"test":"node --test"}}'],
    ['package dependencies', '{"type":"module","dependencies":{"react":"latest"}}'],
  ].map(([name, content]): ParityFixture => ({
    name: name!,
    ruleId: RULES.PACKAGE_POLICY,
    reasonCode: REASONS.PACKAGE_POLICY,
    invalidFiles: () =>
      addFile({ path: 'package.json', mediaType: 'application/json', content: content! }),
  })),
  {
    name: 'bare application import',
    ruleId: RULES.IMPORT_POLICY,
    reasonCode: REASONS.DEPENDENCY_UNSUPPORTED,
    invalidFiles: () => replaceFile('src/app.ts', "import React from 'react';\nexport { React };"),
  },
  {
    name: 'CommonJS module format',
    ruleId: RULES.MODULE_FORMAT,
    reasonCode: REASONS.DEPENDENCY_UNSUPPORTED,
    invalidFiles: () => replaceFile('src/app.ts', 'module.exports = { value: 1 };\n'),
  },
];

async function loadFactoryWebPreviewHelper(): Promise<FactoryWebPreviewHelper> {
  const moduleUrl = pathToFileURL(path.join(FACTORY_PROFILE_ROOT, 'runner/common.mjs')).href;
  return (await import(moduleUrl)) as FactoryWebPreviewHelper;
}

describe('NODE_WEB_PREVIEW_24_V1 Docker assets', () => {
  it('keeps the Factory web build profile separate and digest/toolchain pinned', async () => {
    const dockerfile = await profileFile(FACTORY_PROFILE_ROOT, 'Dockerfile');

    expect(dockerfile).toContain('v24.19.0');
    expect(dockerfile).toContain('typescript-6.0.3.tgz');
    expect(dockerfile).toContain('org.brq.sandbox.factory-profile="node-web-preview-24-v1"');
    expect(dockerfile).toContain('org.brq.preview.artifact-export-abi="1.0.0"');
    expect(dockerfile).toContain('USER 65532:65532');
    expect(dockerfile).not.toMatch(/\bEXPOSE\b|factory-sandbox|integration-fixture/u);
  });

  it('uses only fixed helpers and exports the strict canonical artifact shape', async () => {
    const [prepare, test, exporter] = await Promise.all([
      profileFile(FACTORY_PROFILE_ROOT, 'runner/prepare.mjs'),
      profileFile(FACTORY_PROFILE_ROOT, 'runner/test.mjs'),
      profileFile(FACTORY_PROFILE_ROOT, 'runner/export.mjs'),
    ]);

    expect(prepare).toContain('validateExecutionProfileFiles(envelope.files)');
    expect(test).toContain("'/usr/local/bin/node'");
    expect(test).toContain('shell: false');
    expect(`${prepare}\n${test}\n${exporter}`).not.toMatch(
      /npm\s+(?:run|test|start)|yarn|pnpm|child_process\.exec\b/u,
    );
    expect(exporter).toContain('abiVersion: ARTIFACT_ABI_VERSION');
    expect(exporter).toContain('exporterVersion: ARTIFACT_EXPORTER_VERSION');
    expect(exporter).toContain('files: files.map');
    expect(exporter).not.toContain('sandboxResultHash');
  });

  it('fails closed for package scripts, external resources and inline active content', async () => {
    const profile = await loadFactoryWebPreviewHelper();

    expect(() =>
      profile.validateOptionalPackage(
        Buffer.from('{"scripts":{"start":"node app.js"},"type":"module"}', 'utf8'),
      ),
    ).toThrowError('PACKAGE_POLICY');
    expect(() =>
      profile.validatePreviewSource(
        'index.html',
        Buffer.from('<script src="https://example.com/app.js"></script>', 'utf8'),
      ),
    ).toThrowError('EXTERNAL_OR_UNSAFE_REFERENCE');
    expect(() =>
      profile.validatePreviewSource(
        'index.html',
        Buffer.from('<button onclick="run()">Run</button>', 'utf8'),
      ),
    ).toThrowError('INLINE_ACTIVE_CONTENT');
  });

  it('accepts the host generation subset with ESM package metadata and fixed tests', async () => {
    const profile = await loadFactoryWebPreviewHelper();
    const manifest = {
      files: [
        { path: 'index.html' },
        { path: 'package.json' },
        { path: 'src/app.ts' },
        { path: 'src/styles.css' },
        { path: 'src/config.json' },
        { path: 'src/message.txt' },
        { path: 'src/data.xml' },
        { path: 'test/app.test.ts' },
      ],
    } as const;

    const sources = profile.sourcePathsFromManifest(manifest);
    expect(sources).toEqual(['src/app.ts', 'test/app.test.ts']);
    expect(profile.testPathsFromSources(sources)).toEqual(['test/app.test.ts']);
    expect(() =>
      profile.validateOptionalPackage(
        Buffer.from('{"name":"fixture","private":true,"type":"module"}\n', 'utf8'),
      ),
    ).not.toThrow();
    expect(() =>
      profile.validatePreviewSource(
        'index.html',
        Buffer.from('<script type="module" src="./src/app.js"></script>', 'utf8'),
      ),
    ).not.toThrow();
    expect(() =>
      profile.validatePreviewSource(
        'src/app.ts',
        Buffer.from("import { value } from './value.js';\nexport { value };\n", 'utf8'),
      ),
    ).not.toThrow();
    expect(profile.mediaTypeFor('src/styles.css')).toBe('text/css');
    expect(profile.mediaTypeFor('index.html')).toBe('text/html');
    expect(profile.mediaTypeFor('src/config.json')).toBe('application/json');
    expect(profile.mediaTypeFor('src/message.txt')).toBe('text/plain');
    expect(profile.mediaTypeFor('src/data.xml')).toBe('text/xml');
  });

  it('keeps every host-forbidden module extension rejected by the active helper', async () => {
    const profile = await loadFactoryWebPreviewHelper();

    for (const extension of ['.cjs', '.cts', '.jsx', '.mjs', '.mts', '.tsx']) {
      expect(() =>
        profile.sourcePathsFromManifest({
          files: [{ path: 'src/app.ts' }, { path: `src/unsupported${extension}` }],
        }),
      ).toThrowError('UNSUPPORTED_SOURCE_PROFILE');
    }
    expect(() => profile.testPathsFromSources(['src/app.ts'])).toThrowError('NO_TEST_FILES');
  });

  it.each(PARITY_MATRIX)(
    'keeps profile, generation, host and pure Sandbox parity for $name',
    async ({ ruleId, reasonCode, invalidFiles }) => {
      const projection = projectGenerationProfileConstraints(EXECUTION_PROFILE);
      const declaredRuleIds = [
        EXECUTION_PROFILE.files.rule,
        EXECUTION_PROFILE.files.requiredFilesRule,
        EXECUTION_PROFILE.sourceDiscovery.rule,
        EXECUTION_PROFILE.testDiscovery.rule,
        EXECUTION_PROFILE.modulePolicy.formatRule,
        EXECUTION_PROFILE.modulePolicy.importRule,
        EXECUTION_PROFILE.packagePolicy.rule,
        EXECUTION_PROFILE.contentRules.html.elementsRule,
        EXECUTION_PROFILE.contentRules.html.inlineActiveRule,
        EXECUTION_PROFILE.contentRules.html.referencesRule,
        EXECUTION_PROFILE.contentRules.css.importRule,
        EXECUTION_PROFILE.contentRules.css.urlsRule,
        EXECUTION_PROFILE.contentRules.javaScript.capabilitiesRule,
        EXECUTION_PROFILE.contentRules.javaScript.referencesRule,
        EXECUTION_PROFILE.contentRules.json.rule,
      ];
      const files = invalidFiles();
      const host = createFactoryExecutionProfileValidator(EXECUTION_PROFILE).validate({
        bundleHash: 'b'.repeat(64),
        files,
      });
      const sandbox = await loadFactoryWebPreviewHelper();
      const sandboxFiles = files.map((file) => ({ ...file, content: Buffer.from(file.content) }));

      expect(declaredRuleIds).toContainEqual({ ruleId, reasonCode });
      expect(projection.rules.some((rule) => rule.id === ruleId)).toBe(true);
      expect(host.issues).toContainEqual({ ruleId, reasonCode });
      expect(() => sandbox.validateExecutionProfileFiles(sandboxFiles)).toThrowError(reasonCode);
    },
  );

  it('pins the Preview runtime to a fixed server, health path and bounded TTL', async () => {
    const [dockerfile, prepare, server, relay] = await Promise.all([
      profileFile(PREVIEW_RUNTIME_ROOT, 'Dockerfile'),
      profileFile(PREVIEW_RUNTIME_ROOT, 'runner/prepare.mjs'),
      profileFile(PREVIEW_RUNTIME_ROOT, 'runner/serve.mjs'),
      profileFile(PREVIEW_RUNTIME_ROOT, 'runner/relay.mjs'),
    ]);

    expect(dockerfile).toContain('org.brq.preview.profile="node-web-preview-24-v1"');
    expect(dockerfile).toContain('USER 65532:65532');
    expect(dockerfile).not.toMatch(/\bEXPOSE\b|npm|yarn|pnpm/u);
    expect(prepare).toContain('validateArtifactEnvelope');
    expect(server).toContain('HEALTH_PATH');
    expect(server).toContain("request.method !== 'GET' && request.method !== 'HEAD'");
    expect(server).toContain('ttlSeconds >= 60 && ttlSeconds <= 900');
    expect(server).toContain("'Content-Security-Policy'");
    expect(server).toContain("server.listen(INTERNAL_PORT, '127.0.0.1'");
    expect(server).not.toContain('0.0.0.0');
    expect(server).not.toMatch(/child_process|shell:\s*true|package\.json/u);
    expect(relay).toContain("value.method === 'GET' || value.method === 'HEAD'");
    expect(relay).toContain("host: '127.0.0.1'");
    expect(relay).toContain('port: INTERNAL_PORT');
    expect(relay).not.toMatch(/child_process|shell:\s*true|package\.json/u);
  });
});
