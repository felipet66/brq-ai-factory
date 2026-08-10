import type { PreviewArtifactContentStore } from '@brq/preview-artifact';

import {
  type CreateDockerPreviewRunnerOptions,
  type DockerPreviewImageConfiguration,
  resolveDockerPreviewRunnerOptions,
} from './configuration';
import { createNodeDockerCommandExecutor } from './docker-cli';
import { createNodePreviewHealthProbe } from './health-probe';
import { createNodePreviewLoopbackRelay } from './loopback-relay';
import {
  createDockerPreviewRunnerWithDependencies,
  type DockerPreviewGatewayTarget,
  type DockerPreviewRunner,
} from './internal-factory';

export type {
  CreateDockerPreviewRunnerOptions,
  DockerPreviewGatewayTarget,
  DockerPreviewImageConfiguration,
  DockerPreviewRunner,
  PreviewArtifactContentStore,
};

export function createDockerPreviewRunner(
  rawOptions: CreateDockerPreviewRunnerOptions,
): DockerPreviewRunner {
  const options = resolveDockerPreviewRunnerOptions(rawOptions);
  return createDockerPreviewRunnerWithDependencies(options, {
    executor: createNodeDockerCommandExecutor({
      executable: options.dockerExecutable,
      dockerHost: options.dockerHost,
    }),
    healthProbe: createNodePreviewHealthProbe(),
    createRelay: createNodePreviewLoopbackRelay,
  });
}
