import path from 'node:path';

import { sandboxExecutionPolicySchema, type SandboxExecutionPolicy } from '@brq/sandbox-runner';
import type { DockerSandboxImageConfiguration } from '@brq/sandbox-runner/docker';
import type { FactoryPipelineConfiguration } from '@brq/factory-pipeline';
import { z } from 'zod';

export const FACTORY_SANDBOX_POLICY_ID = 'NODE_TYPESCRIPT_24_V1' as const;
export const FACTORY_SANDBOX_PROFILE_VERSION = '1.0.0' as const;
export const FACTORY_SANDBOX_NODE_VERSION = '24.19.0' as const;
export const FACTORY_SANDBOX_TYPESCRIPT_VERSION = '6.0.3' as const;
export const FACTORY_CODE_GENERATOR_AGENT_VERSION = '1.0.0' as const;
export const FACTORY_CODE_GENERATOR_MODEL = 'gpt-5-mini' as const;

/** Host-owned composition profile; these values are not defaults of the domain modules. */
export const FACTORY_PIPELINE_CONFIGURATION: FactoryPipelineConfiguration = Object.freeze({
  codeGenerator: Object.freeze({
    agentVersion: FACTORY_CODE_GENERATOR_AGENT_VERSION,
    model: FACTORY_CODE_GENERATOR_MODEL,
  }),
  sandbox: Object.freeze({ policyId: FACTORY_SANDBOX_POLICY_ID }),
});

const factorySandboxEnvironmentSchema = z
  .object({
    BRQ_FACTORY_SANDBOX_MODE: z.literal('DOCKER'),
    BRQ_FACTORY_WORKSPACE_ROOT: z.string().trim().min(1),
    BRQ_FACTORY_SANDBOX_DOCKER_EXECUTABLE: z.string().trim().min(1),
    BRQ_FACTORY_SANDBOX_DOCKER_HOST: z.string().trim().min(1),
    BRQ_FACTORY_SANDBOX_IMAGE_REFERENCE: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/u),
    BRQ_FACTORY_SANDBOX_IMAGE_ID: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    BRQ_FACTORY_SANDBOX_IMAGE_PLATFORM: z.enum(['linux/amd64', 'linux/arm64']),
  })
  .passthrough();

function command(step: 'prepare' | 'typecheck' | 'build' | 'test', timeoutMs: number) {
  return Object.freeze({
    executable: '/usr/local/bin/node',
    args: Object.freeze([`/opt/brq/runner/${step}.mjs`, '--workspace', '/workspace/project']),
    workingDirectory: '/workspace/project' as const,
    environment: Object.freeze({ CI: '1' as const, NO_COLOR: '1' as const }),
    requiredFiles: Object.freeze([]),
    timeoutMs,
  });
}

export const FACTORY_SANDBOX_POLICY: SandboxExecutionPolicy = Object.freeze(
  sandboxExecutionPolicySchema.parse({
    policyId: FACTORY_SANDBOX_POLICY_ID,
    version: FACTORY_SANDBOX_PROFILE_VERSION,
    packageManager: 'NONE',
    runtime: { name: 'NODE', version: FACTORY_SANDBOX_NODE_VERSION },
    helperAbiVersion: '1.0.0',
    dependencySnapshotHash: null,
    steps: {
      PREPARE: command('prepare', 30_000),
      TYPECHECK: command('typecheck', 90_000),
      BUILD: command('build', 120_000),
      TEST: command('test', 90_000),
    },
  }),
);

export interface FactorySandboxRuntimeConfiguration {
  readonly workspaceRoot: string;
  readonly dockerExecutable: string;
  readonly dockerHost: string;
  readonly policy: SandboxExecutionPolicy;
  readonly image: DockerSandboxImageConfiguration;
}

function requireAbsolutePath(value: string, label: string): string {
  if (
    !path.isAbsolute(value) ||
    path.resolve(value) !== value ||
    path.parse(value).root === value
  ) {
    throw new TypeError(`${label} deve ser um caminho absoluto e específico.`);
  }
  return value;
}

export function resolveFactorySandboxRuntimeConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): FactorySandboxRuntimeConfiguration {
  const parsed = factorySandboxEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new TypeError(
      'O Sandbox da Factory exige configuração Docker explícita e digest-pinned.',
      { cause: parsed.error },
    );
  }
  return Object.freeze({
    workspaceRoot: requireAbsolutePath(
      parsed.data.BRQ_FACTORY_WORKSPACE_ROOT,
      'BRQ_FACTORY_WORKSPACE_ROOT',
    ),
    dockerExecutable: requireAbsolutePath(
      parsed.data.BRQ_FACTORY_SANDBOX_DOCKER_EXECUTABLE,
      'BRQ_FACTORY_SANDBOX_DOCKER_EXECUTABLE',
    ),
    dockerHost: parsed.data.BRQ_FACTORY_SANDBOX_DOCKER_HOST,
    policy: FACTORY_SANDBOX_POLICY,
    image: Object.freeze({
      reference: parsed.data.BRQ_FACTORY_SANDBOX_IMAGE_REFERENCE,
      expectedImageId: parsed.data.BRQ_FACTORY_SANDBOX_IMAGE_ID,
      platform: parsed.data.BRQ_FACTORY_SANDBOX_IMAGE_PLATFORM,
      requiredLabels: Object.freeze({
        'org.brq.sandbox.factory-profile': 'node-typescript-24-v1',
      }),
      toolchainVersions: Object.freeze({
        NODE: FACTORY_SANDBOX_NODE_VERSION,
        TYPESCRIPT: FACTORY_SANDBOX_TYPESCRIPT_VERSION,
      }),
    }),
  });
}
