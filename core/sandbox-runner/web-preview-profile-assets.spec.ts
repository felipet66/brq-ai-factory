import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const FACTORY_PROFILE_ROOT = path.resolve(process.cwd(), 'apps/web/docker/factory-web-preview');
const PREVIEW_RUNTIME_ROOT = path.resolve(process.cwd(), 'apps/web/docker/preview-runner');

function profileFile(root: string, relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8');
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

    expect(prepare).toContain("'INDEX_HTML_REQUIRED'");
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
    const moduleUrl = pathToFileURL(path.join(FACTORY_PROFILE_ROOT, 'runner/common.mjs')).href;
    const profile = (await import(moduleUrl)) as {
      validateOptionalPackage(content: Buffer): void;
      validatePreviewSource(filePath: string, content: Buffer): void;
    };

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
