import path from 'node:path';

import type { PreviewArtifactContentStore } from '@brq/preview-artifact';

export interface DockerPreviewImageConfiguration {
  readonly reference: string;
  readonly expectedImageId: string;
  readonly platform: 'linux/amd64' | 'linux/arm64';
  readonly requiredLabels: Readonly<Record<string, string>>;
}

export interface CreateDockerPreviewRunnerOptions {
  readonly dockerExecutable: string;
  readonly dockerHost: string;
  readonly image: DockerPreviewImageConfiguration;
  readonly contentStore: PreviewArtifactContentStore;
  readonly maxActivePreviews?: number;
  readonly now?: () => number;
}

export interface ResolvedDockerPreviewRunnerOptions extends CreateDockerPreviewRunnerOptions {
  readonly maxActivePreviews: number;
}

const IMAGE_REFERENCE = /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/u;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;
const LABEL = /^[a-z0-9][a-z0-9._/-]{0,127}$/u;

export function resolveDockerPreviewRunnerOptions(
  options: CreateDockerPreviewRunnerOptions,
): ResolvedDockerPreviewRunnerOptions {
  if (
    !path.isAbsolute(options.dockerExecutable) ||
    path.resolve(options.dockerExecutable) !== options.dockerExecutable ||
    path.parse(options.dockerExecutable).root === options.dockerExecutable ||
    options.dockerHost.trim().length === 0 ||
    !IMAGE_REFERENCE.test(options.image.reference) ||
    !IMAGE_ID.test(options.image.expectedImageId) ||
    typeof options.contentStore?.readApproved !== 'function' ||
    typeof options.contentStore.consume !== 'function' ||
    typeof options.contentStore.remove !== 'function'
  ) {
    throw new TypeError('A configuração Docker do Preview Runner é inválida.');
  }
  for (const [key, value] of Object.entries(options.image.requiredLabels)) {
    if (!LABEL.test(key) || value.length === 0 || value.length > 256) {
      throw new TypeError('A identidade de labels da imagem de Preview é inválida.');
    }
  }
  const maxActivePreviews = options.maxActivePreviews ?? 4;
  if (!Number.isInteger(maxActivePreviews) || maxActivePreviews < 1 || maxActivePreviews > 32) {
    throw new TypeError('A capacidade local de Preview é inválida.');
  }
  return Object.freeze({ ...options, maxActivePreviews });
}
