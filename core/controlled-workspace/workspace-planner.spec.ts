import { describe, expect, it } from 'vitest';

import { calculateWorkspaceBundleContentHash, calculateWorkspaceContentHash } from './hashing';
import { CONTROLLED_WORKSPACE_ERROR_CODES, ControlledWorkspaceError } from './errors';
import { createWorkspacePlan } from './workspace-planner';
import { createControlledWorkspacePlanner } from './workspace-planner';
import { createWorkspacePlanRequestFixture } from './testing/controlled-workspace-fixtures';
import type { WorkspaceFileRequest, WorkspacePlanRequest } from './contracts';

function expectPlanError(
  operation: () => unknown,
  code: (typeof CONTROLLED_WORKSPACE_ERROR_CODES)[keyof typeof CONTROLLED_WORKSPACE_ERROR_CODES],
): ControlledWorkspaceError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ControlledWorkspaceError);
    expect((error as ControlledWorkspaceError).code).toBe(code);
    return error as ControlledWorkspaceError;
  }
  throw new Error('Expected ControlledWorkspaceError.');
}

function fileFor(
  path: string,
  overrides: Partial<WorkspaceFileRequest> = {},
): WorkspaceFileRequest {
  const content = overrides.content ?? 'export const value = true;\n';
  return {
    path,
    content,
    encoding: 'UTF-8',
    mediaType: 'text/typescript',
    purpose: 'SOURCE',
    byteLength: Buffer.byteLength(content, 'utf8'),
    contentHash: calculateWorkspaceContentHash(content),
    ...overrides,
  };
}

function requestWithFiles(files: readonly WorkspaceFileRequest[]): WorkspacePlanRequest {
  return createWorkspacePlanRequestFixture({ files: [...files] });
}

describe('controlled workspace planner', () => {
  it('creates a sorted deterministic and deeply immutable plan', () => {
    const request = createWorkspacePlanRequestFixture();
    const reversed = createWorkspacePlanRequestFixture({ files: [...request.files].reverse() });

    const first = createWorkspacePlan(request);
    const second = createWorkspacePlan(reversed);

    expect(first).toEqual(second);
    expect(first.files.map((file) => file.path)).toEqual(['package.json', 'src/index.ts']);
    expect(first.lineage.planHash).toBe(first.metadata.planHash);
    expect(first.metadata.policyHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.metadata.configurationHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.files)).toBe(true);
    expect(Object.isFrozen(first.files[0])).toBe(true);
  });

  it('creates a reusable immutable planner with host limits', () => {
    const planner = createControlledWorkspacePlanner({ limits: { maxFiles: 2 } });
    expect(Object.isFrozen(planner)).toBe(true);
    expect(planner.plan(createWorkspacePlanRequestFixture()).files).toHaveLength(2);
  });

  it('binds the declared file bytes and content hash before planning', () => {
    const request = createWorkspacePlanRequestFixture();
    const file = request.files[0];
    if (file === undefined) throw new Error('Fixture file missing.');

    expectPlanError(
      () =>
        createWorkspacePlan({
          ...request,
          files: [{ ...file, byteLength: file.byteLength + 1 }, ...request.files.slice(1)],
        }),
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_REQUEST,
    );
    expectPlanError(
      () =>
        createWorkspacePlan({
          ...request,
          files: [{ ...file, contentHash: 'd'.repeat(64) }, ...request.files.slice(1)],
        }),
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_REQUEST,
    );
  });

  it('recalculates and verifies the canonical bundle content hash', () => {
    const request = createWorkspacePlanRequestFixture();
    expect(request.source.bundleContentHash).toBe(
      calculateWorkspaceBundleContentHash(request.files),
    );

    expectPlanError(
      () =>
        createWorkspacePlan({
          ...request,
          source: { ...request.source, bundleContentHash: 'f'.repeat(64) },
        }),
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_REQUEST,
    );
  });

  it.each([
    '/etc/passwd.ts',
    'C:/temp/file.ts',
    '//server/share/file.ts',
    '../outside.ts',
    'src/../outside.ts',
    'src\\index.ts',
    'src/.hidden.ts',
    'src//index.ts',
    'src/ file.ts',
    'src/dir./index.ts',
    'node_modules/index.ts',
    'src/CON.ts',
    'src/file name.ts',
    'src/file?.ts',
  ])('rejects unsafe portable path %s', (unsafePath) => {
    const error = expectPlanError(
      () => createWorkspacePlan(requestWithFiles([fileFor(unsafePath)])),
      CONTROLLED_WORKSPACE_ERROR_CODES.UNSAFE_PATH,
    );
    expect(error.message).not.toContain(unsafePath);
  });

  it('rejects non-NFC paths and control characters', () => {
    expectPlanError(
      () => createWorkspacePlan(requestWithFiles([fileFor('src/cafe\u0301.ts')])),
      CONTROLLED_WORKSPACE_ERROR_CODES.UNSAFE_PATH,
    );
    expectPlanError(
      () => createWorkspacePlan(requestWithFiles([fileFor('src/bad\u0000.ts')])),
      CONTROLLED_WORKSPACE_ERROR_CODES.UNSAFE_PATH,
    );
  });

  it('accepts NFC Unicode paths and Next route syntax', () => {
    const plan = createWorkspacePlan(
      requestWithFiles([
        fileFor('src/aplicação/[id]/page.ts'),
        fileFor('src/app/(admin)/@modal/page.ts'),
      ]),
    );
    expect(plan.files).toHaveLength(2);
  });

  it.each([
    ['config/credentials.local.json', 'application/json'],
    ['config/secrets.prod.yaml', 'application/yaml'],
    ['config/private-key.ts', 'text/typescript'],
    ['config/private_key.test.ts', 'text/typescript'],
    ['config/id_rsa.ts', 'text/typescript'],
    ['config/id_ed25519.pub.txt', 'text/plain'],
    ['config/authorized_keys.backup.txt', 'text/plain'],
    ['config/known_hosts.local.txt', 'text/plain'],
    ['config/git-credentials.backup.txt', 'text/plain'],
  ] as const)('rejects sensitive filename pattern %s', (sensitivePath, mediaType) => {
    const error = expectPlanError(
      () => createWorkspacePlan(requestWithFiles([fileFor(sensitivePath, { mediaType })])),
      CONTROLLED_WORKSPACE_ERROR_CODES.UNSAFE_PATH,
    );
    expect(error.sourceCode).toBe('SENSITIVE_SEGMENT');
  });

  it('does not reject ordinary names that merely contain sensitive words', () => {
    const plan = createWorkspacePlan(
      requestWithFiles([fileFor('src/credentials-manager.ts'), fileFor('src/user-id.ts')]),
    );
    expect(plan.files).toHaveLength(2);
  });

  it.each([
    ['src/File.ts', 'src/file.ts'],
    ['src/Ａ.ts', 'src/a.ts'],
    ['src/config.json', 'src/config.json/index.ts'],
  ])('rejects portable collision between %s and %s', (first, second) => {
    const firstFile = fileFor(first, {
      mediaType: first.endsWith('.json') ? 'application/json' : 'text/typescript',
    });
    const error = expectPlanError(
      () => createWorkspacePlan(requestWithFiles([firstFile, fileFor(second)])),
      CONTROLLED_WORKSPACE_ERROR_CODES.PATH_COLLISION,
    );
    expect(error.message).not.toContain(first);
    expect(error.message).not.toContain(second);
  });

  it('rejects unsupported extensions and media type mismatches', () => {
    expectPlanError(
      () => createWorkspacePlan(requestWithFiles([fileFor('src/image.png')])),
      CONTROLLED_WORKSPACE_ERROR_CODES.UNSAFE_PATH,
    );
    expectPlanError(
      () =>
        createWorkspacePlan(
          requestWithFiles([fileFor('src/index.ts', { mediaType: 'text/javascript' })]),
        ),
      CONTROLLED_WORKSPACE_ERROR_CODES.UNSAFE_PATH,
    );
  });

  it('enforces configured limits without allowing absolute limits to be raised', () => {
    expectPlanError(
      () => createWorkspacePlan(createWorkspacePlanRequestFixture(), { limits: { maxFiles: 1 } }),
      CONTROLLED_WORKSPACE_ERROR_CODES.LIMIT_EXCEEDED,
    );
    expectPlanError(
      () =>
        createWorkspacePlan(requestWithFiles([fileFor('src/index.ts')]), {
          limits: { maxFileBytes: 8, maxBundleBytes: 16 },
        }),
      CONTROLLED_WORKSPACE_ERROR_CODES.LIMIT_EXCEEDED,
    );
    expectPlanError(
      () =>
        createWorkspacePlan(createWorkspacePlanRequestFixture(), {
          limits: { maxFiles: 97 },
        }),
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_CONFIGURATION,
    );
    expectPlanError(
      () =>
        createWorkspacePlan(createWorkspacePlanRequestFixture(), {
          limits: { maxFileBytes: 32, maxBundleBytes: 16 },
        }),
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_CONFIGURATION,
    );
    expectPlanError(
      () =>
        createWorkspacePlan(createWorkspacePlanRequestFixture(), {
          limits: { maxFiles: 0 },
        }),
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_CONFIGURATION,
    );
  });

  it('enforces absolute UTF-8 byte and portable path limits without truncation', () => {
    const exactContent = 'a'.repeat(64 * 1024);
    const exactFile = fileFor('src/exact.txt', {
      content: exactContent,
      mediaType: 'text/plain',
    });
    const plan = createWorkspacePlan(requestWithFiles([exactFile]));
    expect(plan.files[0]?.content).toBe(exactContent);
    expect(plan.files[0]?.byteLength).toBe(64 * 1024);

    expectPlanError(
      () =>
        createWorkspacePlan(
          requestWithFiles([
            fileFor('src/too-large.txt', {
              content: 'a'.repeat(64 * 1024 + 1),
              mediaType: 'text/plain',
            }),
          ]),
        ),
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_REQUEST,
    );
    expectPlanError(
      () => createWorkspacePlan(requestWithFiles([fileFor(`${'a'.repeat(256)}.ts`)])),
      CONTROLLED_WORKSPACE_ERROR_CODES.UNSAFE_PATH,
    );
    expectPlanError(
      () =>
        createWorkspacePlan(
          requestWithFiles([fileFor(`${Array.from({ length: 20 }, () => 'a').join('/')}/x.ts`)]),
        ),
      CONTROLLED_WORKSPACE_ERROR_CODES.UNSAFE_PATH,
    );
    expectPlanError(
      () =>
        createWorkspacePlan(
          requestWithFiles([
            fileFor(`${'a'.repeat(200)}/${'b'.repeat(200)}/${'c'.repeat(108)}.ts`),
          ]),
        ),
      CONTROLLED_WORKSPACE_ERROR_CODES.UNSAFE_PATH,
    );
  });

  it('rejects binary controls, unpaired Unicode and high-confidence secrets', () => {
    expectPlanError(
      () =>
        createWorkspacePlan(
          requestWithFiles([
            fileFor('src/data.txt', { content: 'a\u0001b', mediaType: 'text/plain' }),
          ]),
        ),
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_REQUEST,
    );
    const malformed = `bad${String.fromCharCode(0xd800)}`;
    expectPlanError(
      () =>
        createWorkspacePlan(
          requestWithFiles([
            fileFor('src/data.txt', { content: malformed, mediaType: 'text/plain' }),
          ]),
        ),
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_REQUEST,
    );
    const malformedPair = `${String.fromCharCode(0xd800)}x`;
    expectPlanError(
      () =>
        createWorkspacePlan(
          requestWithFiles([
            fileFor('src/data.txt', { content: malformedPair, mediaType: 'text/plain' }),
          ]),
        ),
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_REQUEST,
    );
    expectPlanError(
      () =>
        createWorkspacePlan(
          requestWithFiles([
            fileFor('src/key.txt', {
              content: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key',
              mediaType: 'text/plain',
            }),
          ]),
        ),
      CONTROLLED_WORKSPACE_ERROR_CODES.UNSUPPORTED_CONTENT,
    );
    expectPlanError(
      () =>
        createWorkspacePlan(
          requestWithFiles([
            fileFor('src/token.txt', {
              content: `token sk-proj-${'A'.repeat(24)}`,
              mediaType: 'text/plain',
            }),
          ]),
        ),
      CONTROLLED_WORKSPACE_ERROR_CODES.UNSUPPORTED_CONTENT,
    );
    expectPlanError(
      () =>
        createWorkspacePlan(
          requestWithFiles([
            fileFor('src/config.ts', {
              content: "export const api_key = 'abcdefghijklmnop1234';\n",
            }),
          ]),
        ),
      CONTROLLED_WORKSPACE_ERROR_CODES.UNSUPPORTED_CONTENT,
    );
  });

  it('allows environment-variable references because no credential literal is present', () => {
    const plan = createWorkspacePlan(
      requestWithFiles([
        fileFor('src/config.ts', { content: 'export const key = process.env.OPENAI_API_KEY;\n' }),
      ]),
    );
    expect(plan.files).toHaveLength(1);
  });
});
