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
    expect(PROFILE.identity.profileHash).toBe(
      'cffc60459d28119fa0e83488ff87ff017d49668ac542002194a40e9342c1c31f',
    );
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
    expect(generation.projectionVersion).toBe('1.1.0');
    expect(generation.buildSemantics).toEqual(PROFILE.buildSemantics);
    expect(generation.previewProjection).toEqual(PROFILE.previewProjection);
    expect(generation.rules.find(({ id }) => id === RULES.TEST_REQUIRED)).toMatchObject({
      requirement: expect.stringContaining('ends exactly in one of the supplied suffixes'),
      parameters: { required: true, suffixes: ['.test.js', '.test.ts'] },
    });
    expect(generation.rules.find(({ id }) => id === RULES.REQUIRED_FILES)).toMatchObject({
      requirement: expect.stringContaining('MUST exist exactly once'),
      parameters: { files: ['index.html'] },
    });
    expect(generation.generationProjectionHash).toBe(
      'aec4f86423305f336132d1b924399574736fab7689a0db5669d28e6028e91582',
    );
    expect(sandbox.snapshotHash).toBe(
      '75d736b1fc3b102df86c715e62f59c87fff1ca069db604400d98b5a2f13be591',
    );
    expect(projectGenerationProfileConstraints(PROFILE)).toEqual(generation);
    expect(projectSandboxExecutionProfileSnapshot(PROFILE)).toEqual(sandbox);
    expect(Object.isFrozen(generation.rules)).toBe(true);
    expect(Object.isFrozen(sandbox.rules)).toBe(true);
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
