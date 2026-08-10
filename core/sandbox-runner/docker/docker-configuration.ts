import path from 'node:path';

import { z } from 'zod';

import type { SandboxRunnerHostOptions } from '../contracts';
import {
  SANDBOX_RUNNER_ERROR_CODES,
  SANDBOX_RUNNER_ERROR_STAGES,
  SandboxRunnerError,
} from '../errors';
import type { SandboxLimits } from '../limits';
import { validateWorkspaceRoot } from './workspace-reader';

const DIGEST_REFERENCE = /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/u;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;
const LOCAL_UNIX_SOCKET = /^unix:\/\/(?:\/[A-Za-z0-9._-]+)+$/u;
const PLATFORM = /^linux\/(?:amd64|arm64)$/u;

const imageConfigurationSchema = z
  .object({
    reference: z.string().regex(DIGEST_REFERENCE),
    expectedImageId: z.string().regex(IMAGE_ID),
    platform: z.string().regex(PLATFORM),
    requiredLabels: z.record(z.string().min(1).max(128), z.string().max(512)),
    toolchainVersions: z.record(z.string().min(1).max(128), z.string().min(1).max(128)),
  })
  .strict();

export interface DockerSandboxImageConfiguration {
  readonly reference: string;
  readonly expectedImageId: string;
  readonly platform: string;
  readonly requiredLabels: Readonly<Record<string, string>>;
  readonly toolchainVersions: Readonly<Record<string, string>>;
}

export interface CreateDockerSandboxRunnerOptions extends SandboxRunnerHostOptions {
  readonly workspaceRoot: string;
  readonly dockerExecutable: string;
  readonly dockerHost: string;
  readonly image: DockerSandboxImageConfiguration;
  readonly limitCeiling?: SandboxLimits;
}

export interface ResolvedDockerSandboxRunnerOptions extends CreateDockerSandboxRunnerOptions {
  readonly workspaceRoot: string;
  readonly dockerExecutable: string;
  readonly dockerHost: string;
  readonly image: DockerSandboxImageConfiguration;
}

function deepFrozenClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== 'object' || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(clone);
  return clone;
}

export function resolveDockerSandboxRunnerOptions(
  options: CreateDockerSandboxRunnerOptions,
): ResolvedDockerSandboxRunnerOptions {
  const image = imageConfigurationSchema.safeParse(options.image);
  const socketPath = options.dockerHost.startsWith('unix://')
    ? options.dockerHost.slice('unix://'.length)
    : '';
  if (
    !image.success ||
    !path.isAbsolute(options.dockerExecutable) ||
    path.resolve(options.dockerExecutable) !== options.dockerExecutable ||
    path.parse(options.dockerExecutable).root === options.dockerExecutable ||
    path.basename(options.dockerExecutable) !== 'docker' ||
    !LOCAL_UNIX_SOCKET.test(options.dockerHost) ||
    path.resolve(socketPath) !== socketPath
  ) {
    throw new SandboxRunnerError('A configuração do adapter Docker é inválida.', {
      code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR,
      stage: SANDBOX_RUNNER_ERROR_STAGES.CONFIGURATION,
    });
  }
  return Object.freeze({
    ...options,
    policies: deepFrozenClone(options.policies),
    ...(options.limitCeiling === undefined
      ? {}
      : { limitCeiling: deepFrozenClone(options.limitCeiling) }),
    workspaceRoot: validateWorkspaceRoot(options.workspaceRoot),
    image: Object.freeze({
      ...image.data,
      requiredLabels: Object.freeze({ ...image.data.requiredLabels }),
      toolchainVersions: Object.freeze({ ...image.data.toolchainVersions }),
    }),
  });
}
