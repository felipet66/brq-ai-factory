import type { SandboxRunner } from '../contracts';
import { createNodeDockerCommandExecutor } from './docker-cli';
import {
  resolveDockerSandboxRunnerOptions,
  type CreateDockerSandboxRunnerOptions,
  type DockerSandboxImageConfiguration,
} from './docker-configuration';
import { createDockerSandboxRunnerWithDependencies } from './internal-factory';

export type { CreateDockerSandboxRunnerOptions, DockerSandboxImageConfiguration };
export {
  DOCKER_SANDBOX_DEPENDENCY_LABEL,
  DOCKER_SANDBOX_HELPER_ABI,
  DOCKER_SANDBOX_HELPER_LABEL,
  DOCKER_SANDBOX_IDLE_ARGUMENT,
  DOCKER_SANDBOX_IDLE_EXECUTABLE,
  DOCKER_SANDBOX_NODE_LABEL,
  DOCKER_SANDBOX_READY_EXECUTABLE,
  type DockerSandboxWorkspaceEnvelope,
} from './helper-contract';

export function createDockerSandboxRunner(
  rawOptions: CreateDockerSandboxRunnerOptions,
): SandboxRunner {
  const options = resolveDockerSandboxRunnerOptions(rawOptions);
  return createDockerSandboxRunnerWithDependencies(options, {
    executor: createNodeDockerCommandExecutor({
      executable: options.dockerExecutable,
      dockerHost: options.dockerHost,
    }),
  });
}
