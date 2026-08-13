import {
  FACTORY_EXECUTION_PROFILE_RULE_IDS,
  NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE,
  projectGenerationProfileConstraints,
  projectSandboxExecutionProfileSnapshot,
} from '@brq/factory-execution-profile';
import { describe, expect, it } from 'vitest';

import { PUBLIC_FACTORY_PROFILE_RULE_IDS } from '@/api/factory-profile-rule-contracts';

import {
  FACTORY_PIPELINE_CONFIGURATION,
  FACTORY_SANDBOX_EXECUTION_PROFILE_SNAPSHOT,
  FACTORY_SANDBOX_POLICY,
} from './factory-sandbox-runtime-configuration';

describe('Factory Execution Profile composition', () => {
  it('correlates the leaf profile, generation projection, Sandbox policy and snapshot', () => {
    const profile = NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE;
    const generation = projectGenerationProfileConstraints(profile);
    const sandbox = projectSandboxExecutionProfileSnapshot(profile);

    expect(FACTORY_PIPELINE_CONFIGURATION.executionProfile).toEqual(profile);
    expect(profile.sandbox).toEqual({
      policyId: FACTORY_SANDBOX_POLICY.policyId,
      policyVersion: FACTORY_SANDBOX_POLICY.version,
    });
    expect(FACTORY_PIPELINE_CONFIGURATION.sandbox.profileSnapshotHash).toBe(sandbox.snapshotHash);
    expect(FACTORY_SANDBOX_EXECUTION_PROFILE_SNAPSHOT).toEqual(sandbox);
    expect(generation.profile.profileHash).toBe(profile.identity.profileHash);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(generation)).toBe(true);
    expect(Object.isFrozen(sandbox)).toBe(true);
  });

  it('keeps the browser-safe profile rule allowlist equal to the authoritative profile rules', () => {
    expect([...PUBLIC_FACTORY_PROFILE_RULE_IDS].sort()).toEqual(
      Object.values(FACTORY_EXECUTION_PROFILE_RULE_IDS).sort(),
    );
  });
});
