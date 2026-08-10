import path from 'node:path';

import { z } from 'zod';

import { previewIdSchema } from '@/api/preview-contracts';

const IMAGE_REFERENCE = /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/u;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;
const ORIGIN_PLACEHOLDER = '{previewId}';

const previewEnvironmentSchema = z
  .object({
    BRQ_PREVIEW_MODE: z.literal('DOCKER'),
    BRQ_PREVIEW_ORIGIN_TEMPLATE: z.string().trim().min(1).max(500),
    BRQ_PREVIEW_COOKIE_SECRET: z.string().min(32).max(1024),
    BRQ_PREVIEW_ARTIFACT_ROOT: z.string().trim().min(1),
    BRQ_PREVIEW_DOCKER_EXECUTABLE: z.string().trim().min(1),
    BRQ_PREVIEW_DOCKER_HOST: z.string().trim().min(1),
    BRQ_PREVIEW_IMAGE_REFERENCE: z.string().regex(IMAGE_REFERENCE),
    BRQ_PREVIEW_IMAGE_ID: z.string().regex(IMAGE_ID),
    BRQ_PREVIEW_IMAGE_PLATFORM: z.enum(['linux/amd64', 'linux/arm64']),
  })
  .passthrough();

export interface PreviewRuntimeConfiguration {
  readonly originTemplate: string;
  readonly cookieSecret: string;
  readonly artifactRoot: string;
  readonly dockerExecutable: string;
  readonly dockerHost: string;
  readonly image: {
    readonly reference: string;
    readonly expectedImageId: string;
    readonly platform: 'linux/amd64' | 'linux/arm64';
  };
}

export interface PreviewArtifactRuntimeConfiguration {
  readonly artifactRoot: string;
}

function requireSpecificAbsolutePath(value: string, label: string): string {
  if (
    !path.isAbsolute(value) ||
    path.resolve(value) !== value ||
    path.parse(value).root === value ||
    (label === 'BRQ_PREVIEW_ARTIFACT_ROOT' &&
      !/(?:^|[-_.])preview(?:[-_.]|$)/iu.test(path.basename(value)))
  ) {
    throw new TypeError(`${label} deve ser um caminho absoluto e específico.`);
  }
  return value;
}

export function previewOriginForId(template: string, previewId: string): string {
  const parsedId = previewIdSchema.parse(previewId);
  if (template.split(ORIGIN_PLACEHOLDER).length !== 2) {
    throw new TypeError('BRQ_PREVIEW_ORIGIN_TEMPLATE exige um único placeholder {previewId}.');
  }
  const candidate = template.replace(ORIGIN_PLACEHOLDER, parsedId);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch (error) {
    throw new TypeError('BRQ_PREVIEW_ORIGIN_TEMPLATE é inválido.', { cause: error });
  }
  if (
    url.origin !== candidate.replace(/\/$/u, '') ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname !== '/'
  ) {
    throw new TypeError('BRQ_PREVIEW_ORIGIN_TEMPLATE deve representar somente uma origin HTTP.');
  }
  if (
    url.protocol === 'http:' &&
    url.hostname !== 'localhost' &&
    !url.hostname.endsWith('.localhost')
  ) {
    throw new TypeError('Preview HTTP sem TLS é permitido somente em hosts localhost.');
  }
  return url.origin;
}

export function previewIdFromRequestUrl(template: string, requestUrl: string): string | null {
  let request: URL;
  try {
    request = new URL(requestUrl);
  } catch {
    return null;
  }
  const pieces = template.split(ORIGIN_PLACEHOLDER);
  const [before = '', after = ''] = pieces;
  if (pieces.length !== 2) return null;
  let sample: URL;
  let hostTemplate: URL;
  try {
    sample = new URL(`${before}${'preview-0'.padEnd(40, '0')}${after}`);
    hostTemplate = new URL(`${before}placeholder${after}`);
  } catch {
    return null;
  }
  if (request.protocol !== sample.protocol || request.port !== sample.port) return null;
  const hostPrefix = hostTemplate.hostname;
  const markerIndex = hostPrefix.indexOf('placeholder');
  if (markerIndex < 0) return null;
  const prefix = hostPrefix.slice(0, markerIndex);
  const suffix = hostPrefix.slice(markerIndex + 'placeholder'.length);
  if (!request.hostname.startsWith(prefix) || !request.hostname.endsWith(suffix)) return null;
  const value = request.hostname.slice(prefix.length, request.hostname.length - suffix.length);
  return previewIdSchema.safeParse(value).success ? value : null;
}

export function resolvePreviewRuntimeConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): PreviewRuntimeConfiguration {
  const parsed = previewEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new TypeError('O Preview Runner exige configuração Docker e origin explícitas.', {
      cause: parsed.error,
    });
  }
  previewOriginForId(parsed.data.BRQ_PREVIEW_ORIGIN_TEMPLATE, `preview-${'0'.repeat(32)}`);
  return Object.freeze({
    originTemplate: parsed.data.BRQ_PREVIEW_ORIGIN_TEMPLATE,
    cookieSecret: parsed.data.BRQ_PREVIEW_COOKIE_SECRET,
    artifactRoot: requireSpecificAbsolutePath(
      parsed.data.BRQ_PREVIEW_ARTIFACT_ROOT,
      'BRQ_PREVIEW_ARTIFACT_ROOT',
    ),
    dockerExecutable: requireSpecificAbsolutePath(
      parsed.data.BRQ_PREVIEW_DOCKER_EXECUTABLE,
      'BRQ_PREVIEW_DOCKER_EXECUTABLE',
    ),
    dockerHost: parsed.data.BRQ_PREVIEW_DOCKER_HOST,
    image: Object.freeze({
      reference: parsed.data.BRQ_PREVIEW_IMAGE_REFERENCE,
      expectedImageId: parsed.data.BRQ_PREVIEW_IMAGE_ID,
      platform: parsed.data.BRQ_PREVIEW_IMAGE_PLATFORM,
    }),
  });
}

export function resolvePreviewArtifactRuntimeConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): PreviewArtifactRuntimeConfiguration {
  const value = environment.BRQ_PREVIEW_ARTIFACT_ROOT;
  if (value === undefined || value.trim().length === 0) {
    throw new TypeError('O Preview Artifact Store exige uma raiz explícita.');
  }
  return Object.freeze({
    artifactRoot: requireSpecificAbsolutePath(value.trim(), 'BRQ_PREVIEW_ARTIFACT_ROOT'),
  });
}
