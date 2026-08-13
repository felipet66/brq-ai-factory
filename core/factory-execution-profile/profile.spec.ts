import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FACTORY_EXECUTION_PROFILE_REASON_CODES as REASONS,
  FACTORY_EXECUTION_PROFILE_RULE_IDS as RULES,
  NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE as PROFILE,
  assertFactoryExecutionProfilePreflight,
  canonicalJson,
  createFactoryExecutionProfileValidator,
  factoryExecutionProfileSchema,
  generationProfileConstraintsSchema,
  projectGenerationProfileConstraints,
  projectSandboxExecutionProfileSnapshot,
  sandboxExecutionProfileSnapshotSchema,
  type ExecutionProfileBundle,
} from './index';

const HASH = 'a'.repeat(64);
const HISTORICAL_PROFILE_FIXTURES = Object.freeze({
  '1.0.0': Object.freeze({
    contractVersion: '1.0.0',
    profileHash: 'cffc60459d28119fa0e83488ff87ff017d49668ac542002194a40e9342c1c31f',
    sandboxSnapshotHash: '75d736b1fc3b102df86c715e62f59c87fff1ca069db604400d98b5a2f13be591',
  }),
});

function validBundle(): ExecutionProfileBundle {
  return {
    bundleHash: HASH,
    files: [
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
    ],
  };
}

describe('FactoryExecutionProfile', () => {
  it('is schema-valid, deeply immutable and pinned to a canonical profile hash', () => {
    expect(factoryExecutionProfileSchema.parse(PROFILE)).toEqual(PROFILE);
    expect(PROFILE.identity).toMatchObject({ version: '1.1.0', contractVersion: '1.1.0' });
    expect(PROFILE.identity.profileHash).toBe(
      'ba54cba53e383deab68a1382422e4dcadb8dc3ed14e903a026e023468dbc8b61',
    );
    expect(PROFILE.identity.profileHash).not.toBe(HISTORICAL_PROFILE_FIXTURES['1.0.0'].profileHash);
    expect(HISTORICAL_PROFILE_FIXTURES['1.0.0']).toEqual({
      contractVersion: '1.0.0',
      profileHash: 'cffc60459d28119fa0e83488ff87ff017d49668ac542002194a40e9342c1c31f',
      sandboxSnapshotHash: '75d736b1fc3b102df86c715e62f59c87fff1ca069db604400d98b5a2f13be591',
    });
    expect(Object.isFrozen(PROFILE)).toBe(true);
    expect(Object.isFrozen(PROFILE.files.allowedExtensions)).toBe(true);
    expect(() => (PROFILE.files.allowedExtensions as string[]).push('.tsx')).toThrow(TypeError);
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  it('derives deterministic, immutable generation and Sandbox projections', () => {
    const generation = projectGenerationProfileConstraints(PROFILE);
    const sandbox = projectSandboxExecutionProfileSnapshot(PROFILE);

    expect(generationProfileConstraintsSchema.parse(generation)).toEqual(generation);
    expect(sandboxExecutionProfileSnapshotSchema.parse(sandbox)).toEqual(sandbox);
    expect(generation.projectionVersion).toBe('1.3.0');
    expect(sandbox.snapshotVersion).toBe('1.1.0');
    expect(generation.buildSemantics).toEqual(PROFILE.buildSemantics);
    expect(generation.previewProjection).toEqual(PROFILE.previewProjection);
    expect(PROFILE.buildSemantics.typeCheck).toEqual({
      requiredDiagnosticCount: 0,
      moduleResolution: 'BUNDLER',
      esModuleInterop: true,
      noEmitOnError: true,
      skipLibCheck: false,
      ambientTypePackages: [],
      javaScriptParameterTyping: 'INFERENCE_OR_JSDOC_REQUIRED',
      nullableDomAccess: 'EXPLICIT_NARROWING_REQUIRED',
      testModuleDeclarations: {
        'node:test':
          'type TestBody = () => void | Promise<void>; export function test(name: string, body: TestBody): void; export default test;',
        'node:assert':
          'interface Assert { ok(value: unknown, message?: string): asserts value; equal(actual: unknown, expected: unknown, message?: string): void; deepEqual(actual: unknown, expected: unknown, message?: string): void; strictEqual(actual: unknown, expected: unknown, message?: string): void; throws(body: () => unknown): void; } const assert: Assert; export = assert;',
        'node:assert/strict': "import assert = require('node:assert'); export = assert;",
      },
      unlistedTestApis: 'FORBIDDEN',
    });
    expect(generation.rules.find(({ id }) => id === RULES.TEST_REQUIRED)).toMatchObject({
      requirement: expect.stringContaining('ends exactly in one of the supplied suffixes'),
      parameters: { required: true, suffixes: ['.test.js', '.test.ts'] },
    });
    expect(generation.rules.find(({ id }) => id === RULES.REQUIRED_FILES)).toMatchObject({
      requirement: expect.stringContaining('MUST exist exactly once'),
      parameters: { files: ['index.html'] },
    });
    const relativeReferencePolicy = {
      trimWhitespace: true,
      requireNonEmpty: true,
      forbiddenLeadingSchemePattern: '^[A-Za-z][A-Za-z0-9+.-]*:',
      forbiddenLeadingSchemeCaseInsensitive: true,
      forbidLeadingDoubleSlash: true,
      forbidLeadingSlash: true,
      forbidLeadingHash: true,
      forbidBackslash: true,
      forbidParentTraversalSegment: true,
      parentTraversalScope: 'PATH_BEFORE_FIRST_QUERY_OR_FRAGMENT',
    };
    for (const ruleId of [RULES.HTML_REFERENCES, RULES.CSS_URLS, RULES.JAVASCRIPT_REFERENCES]) {
      expect(generation.rules.find(({ id }) => id === ruleId)).toMatchObject({
        requirement: expect.stringMatching(
          /non-empty.*URI scheme.*\/\/.*\/.*#.*backslash.*first \? or #.*\.\. segment/u,
        ),
        parameters: { relativeReferencePolicy },
      });
    }
    expect(generation.rules.find(({ id }) => id === RULES.JAVASCRIPT_REFERENCES)).toMatchObject({
      requirement: expect.stringMatching(
        /shared or root-level composition module.*without parent traversal.*final bundle JSON/u,
      ),
      parameters: {
        siblingModuleComposition: 'ROOT_OR_SHARED_MODULE_WITHOUT_PARENT_TRAVERSAL',
      },
    });
    expect(
      generation.rules.find(({ id }) => id === 'build.typescript-zero-diagnostics'),
    ).toMatchObject({
      requirement: expect.stringMatching(
        /zero TypeScript diagnostics.*JavaScript is strictly type-checked.*inferred type or JSDoc.*nullable DOM.*exact supplied API surface.*final JSON/u,
      ),
      parameters: PROFILE.buildSemantics.typeCheck,
    });
    expect(generation.rules.find(({ id }) => RULES.IMPORT_POLICY === id)).toMatchObject({
      requirement: expect.stringMatching(/exact test API surface.*never unlisted exports/u),
    });
    expect(generation.generationProjectionHash).toBe(
      '8e3357a1ca039b9498446d653a06946c06c355be0121019f0c3e47b0518d027c',
    );
    expect(sandbox.snapshotHash).toBe(
      'b671aed30fd78b4bda4219c00fafd1b056e2a46afe7ea81462a9c74d5c098587',
    );
    expect(projectGenerationProfileConstraints(PROFILE)).toEqual(generation);
    expect(projectSandboxExecutionProfileSnapshot(PROFILE)).toEqual(sandbox);
    expect(Object.isFrozen(generation.rules)).toBe(true);
    expect(Object.isFrozen(sandbox.rules)).toBe(true);
  });

  it('rejects drift between allowed test imports and their canonical declarations', () => {
    const driftedProfile = structuredClone(PROFILE) as unknown as {
      buildSemantics: { typeCheck: { testModuleDeclarations: Record<string, string> } };
    };
    delete driftedProfile.buildSemantics.typeCheck.testModuleDeclarations['node:test'];

    expect(factoryExecutionProfileSchema.safeParse(driftedProfile).success).toBe(false);
  });

  it('fails preflight on profile hash or Sandbox snapshot drift', () => {
    const sandbox = projectSandboxExecutionProfileSnapshot(PROFILE);
    expect(
      assertFactoryExecutionProfilePreflight({
        profile: PROFILE,
        sandboxPolicyId: PROFILE.sandbox.policyId,
        sandboxPolicyVersion: PROFILE.sandbox.policyVersion,
        sandboxProfileSnapshotHash: sandbox.snapshotHash,
      }),
    ).toMatchObject({ generation: { profile: PROFILE.identity }, sandbox });

    const driftedProfile = structuredClone(PROFILE) as {
      identity: { profileHash: string };
    } & typeof PROFILE;
    driftedProfile.identity.profileHash = '0'.repeat(64);
    expect(() =>
      assertFactoryExecutionProfilePreflight({
        profile: driftedProfile,
        sandboxPolicyId: PROFILE.sandbox.policyId,
        sandboxPolicyVersion: PROFILE.sandbox.policyVersion,
        sandboxProfileSnapshotHash: sandbox.snapshotHash,
      }),
    ).toThrow('Factory Execution Profile e Sandbox não estão correlacionados.');
    expect(() =>
      assertFactoryExecutionProfilePreflight({
        profile: PROFILE,
        sandboxPolicyId: PROFILE.sandbox.policyId,
        sandboxPolicyVersion: PROFILE.sandbox.policyVersion,
        sandboxProfileSnapshotHash: '0'.repeat(64),
      }),
    ).toThrow('Factory Execution Profile e Sandbox não estão correlacionados.');
  });

  it('produces a deterministic validation hash and diagnoses the paid-run regressions locally', () => {
    const validator = createFactoryExecutionProfileValidator(PROFILE);
    const compatible = validator.validate(validBundle());
    const repeated = validator.validate(validBundle());
    expect(compatible.compatible).toBe(true);
    expect(repeated.profileValidationHash).toBe(compatible.profileValidationHash);

    const withoutTests: ExecutionProfileBundle = {
      ...validBundle(),
      files: validBundle().files.filter((file) => !file.path.includes('.test.')),
    };
    expect(validator.validate(withoutTests).issues).toContainEqual({
      ruleId: RULES.TEST_REQUIRED,
      reasonCode: REASONS.NO_TEST_FILES,
    });

    const withoutSources: ExecutionProfileBundle = {
      ...validBundle(),
      files: validBundle().files.filter((file) => file.path === 'index.html'),
    };
    expect(validator.validate(withoutSources).issues[0]).toEqual({
      ruleId: RULES.SOURCE_REQUIRED,
      reasonCode: REASONS.NO_SUPPORTED_SOURCE,
    });

    const inline: ExecutionProfileBundle = {
      ...validBundle(),
      files: validBundle().files.map((file) =>
        file.path === 'index.html' ? { ...file, content: '<script>alert(1)</script>' } : file,
      ),
    };
    expect(validator.validate(inline).issues).toContainEqual({
      ruleId: RULES.HTML_INLINE_ACTIVE,
      reasonCode: REASONS.INLINE_ACTIVE_CONTENT,
    });
  });

  it.each([
    ['blank', '   '],
    ['URI scheme', 'https://example.test/asset.js'],
    ['case-insensitive URI scheme', 'DATA:text/plain,unsafe'],
    ['protocol-relative prefix', '//cdn.example.test/asset.js'],
    ['root-absolute prefix', '/asset.js'],
    ['fragment prefix', '#asset'],
    ['backslash', '.\\asset.js'],
    ['parent traversal', '../asset.js'],
    ['nested parent traversal', './nested/../asset.js'],
  ])('keeps HTML, CSS and JavaScript aligned for unsafe %s references', (_label, reference) => {
    const validator = createFactoryExecutionProfileValidator(PROFILE);
    const bundles = [
      {
        ruleId: RULES.HTML_REFERENCES,
        bundle: {
          ...validBundle(),
          files: validBundle().files.map((file) =>
            file.path === 'index.html'
              ? { ...file, content: `<img src="${reference}" alt="">` }
              : file,
          ),
        },
      },
      {
        ruleId: RULES.CSS_URLS,
        bundle: {
          ...validBundle(),
          files: [
            ...validBundle().files,
            {
              path: 'src/app.css',
              mediaType: 'text/css',
              content: `.app { background-image: url("${reference}"); }`,
            },
          ],
        },
      },
      {
        ruleId: RULES.JAVASCRIPT_REFERENCES,
        bundle: {
          ...validBundle(),
          files: validBundle().files.map((file) =>
            file.path === 'src/app.ts'
              ? {
                  ...file,
                  content: `import value from "${reference}";\nexport { value };\n`,
                }
              : file,
          ),
        },
      },
    ] as const;

    for (const { ruleId, bundle } of bundles) {
      expect(validator.validate(bundle).issues).toContainEqual({
        ruleId,
        reasonCode: REASONS.EXTERNAL_OR_UNSAFE_REFERENCE,
      });
    }
  });

  it('keeps allowed HTML, CSS and JavaScript references compatible and deterministic', () => {
    const validator = createFactoryExecutionProfileValidator(PROFILE);
    const bundle: ExecutionProfileBundle = {
      ...validBundle(),
      files: [
        ...validBundle().files.map((file) =>
          file.path === 'index.html'
            ? {
                ...file,
                content:
                  '<link rel="stylesheet" href="./src/app.css?next=../outside"><script type="module" src="./src/app.js"></script>',
              }
            : file.path === 'src/app.ts'
              ? {
                  ...file,
                  content:
                    'import value from "./asset.js";\nvoid fetch("./asset.json?next=../outside");\nexport { value };\n',
                }
              : file,
        ),
        {
          path: 'src/app.css',
          mediaType: 'text/css',
          content: '.app { background-image: url("./asset.svg#../outside"); }',
        },
      ],
    };

    const first = validator.validate(bundle);
    const second = validator.validate(bundle);
    expect(first.compatible).toBe(true);
    expect(first.issues).not.toContainEqual({
      ruleId: RULES.HTML_REFERENCES,
      reasonCode: REASONS.EXTERNAL_OR_UNSAFE_REFERENCE,
    });
    expect(first.issues).not.toContainEqual({
      ruleId: RULES.CSS_URLS,
      reasonCode: REASONS.EXTERNAL_OR_UNSAFE_REFERENCE,
    });
    expect(first.issues).not.toContainEqual({
      ruleId: RULES.JAVASCRIPT_REFERENCES,
      reasonCode: REASONS.EXTERNAL_OR_UNSAFE_REFERENCE,
    });
    expect(second).toEqual(first);
  });

  it('rejects sibling-module parent traversal and accepts root composition without it', () => {
    const validator = createFactoryExecutionProfileValidator(PROFILE);
    const rootComposition: ExecutionProfileBundle = {
      bundleHash: HASH,
      files: [
        {
          path: 'index.html',
          mediaType: 'text/html',
          content: '<script type="module" src="./app.js"></script>',
        },
        {
          path: 'app.js',
          mediaType: 'text/javascript',
          content:
            'import { board } from "./modules/game/board.js";\nimport { store } from "./modules/state/store.js";\nexport { board, store };\n',
        },
        {
          path: 'app.test.js',
          mediaType: 'text/javascript',
          content:
            'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { board, store } from "./app.js";\ntest("composition", () => assert.ok(board && store));\n',
        },
        {
          path: 'modules/game/board.js',
          mediaType: 'text/javascript',
          content: 'export const board = {};\n',
        },
        {
          path: 'modules/state/store.js',
          mediaType: 'text/javascript',
          content: 'export const store = {};\n',
        },
      ],
    };
    const siblingTraversal: ExecutionProfileBundle = {
      ...rootComposition,
      files: rootComposition.files.map((file) =>
        file.path === 'modules/game/board.js'
          ? {
              ...file,
              content:
                'import { store } from "../state/store.js";\nexport const board = { store };\n',
            }
          : file,
      ),
    };

    expect(validator.validate(siblingTraversal).issues).toContainEqual({
      ruleId: RULES.JAVASCRIPT_REFERENCES,
      reasonCode: REASONS.EXTERNAL_OR_UNSAFE_REFERENCE,
    });
    expect(validator.validate(rootComposition).compatible).toBe(true);
  });

  it('keeps the checked-in Sandbox snapshot identical to the profile projection', async () => {
    const snapshotPath = path.resolve(
      process.cwd(),
      'apps/web/docker/factory-web-preview/runner/execution-profile.snapshot.json',
    );
    const checkedIn = JSON.parse(await readFile(snapshotPath, 'utf8')) as unknown;
    expect(checkedIn).toEqual(projectSandboxExecutionProfileSnapshot(PROFILE));
  });

  it('remains a provider-, agent- and runtime-neutral leaf package', async () => {
    const root = path.resolve(process.cwd(), 'core/factory-execution-profile');
    const filenames = [
      'canonical-json.ts',
      'immutability.ts',
      'index.ts',
      'profile.ts',
      'projections.ts',
      'schemas.ts',
      'validator.ts',
    ];
    const source = (
      await Promise.all(filenames.map((filename) => readFile(path.join(root, filename), 'utf8')))
    ).join('\n');
    const packageDocument = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
      readonly dependencies: Readonly<Record<string, string>>;
    };

    expect(Object.keys(packageDocument.dependencies)).toEqual(['zod']);
    expect(source).not.toMatch(
      /@brq\/(?:code-generator-agent|factory-pipeline|controlled-workspace|sandbox-runner)|openai|prisma|next\/|docker\/internal/iu,
    );
  });
});
