import path from 'node:path';

import type { PreviewArtifactLimits } from './limits';

const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/u;
const WINDOWS_DRIVE = /^[A-Za-z]:/u;
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu;
const SEGMENT = /^[\p{L}\p{N}_@+.,()\[\]{}-]+$/u;
const SENSITIVE =
  /^(?:\.env|\.git|\.npmrc|\.netrc|\.ssh|credentials(?:\.json)?|id_(?:rsa|dsa|ecdsa|ed25519)|node_modules|private[-_]?key|secrets?(?:\.json)?)$/iu;

export const PREVIEW_ARTIFACT_MEDIA_TYPES = [
  'application/json',
  'image/svg+xml',
  'text/css',
  'text/html',
  'text/javascript',
  'text/plain',
  'text/xml',
] as const;

export type PreviewArtifactMediaType = (typeof PREVIEW_ARTIFACT_MEDIA_TYPES)[number];

const EXTENSION_MEDIA_TYPES: Readonly<Record<string, PreviewArtifactMediaType>> = Object.freeze({
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.xml': 'text/xml',
});

export interface SafePreviewArtifactPath {
  readonly value: string;
  readonly collisionKey: string;
}

export function inspectSafePreviewArtifactPath(
  value: string,
  mediaType: PreviewArtifactMediaType,
  limits: PreviewArtifactLimits,
): SafePreviewArtifactPath {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    value !== value.normalize('NFC') ||
    CONTROL_CHARACTER.test(value) ||
    value.includes('\\') ||
    WINDOWS_DRIVE.test(value) ||
    value.startsWith('//') ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    throw new Error('Unsafe preview artifact path.');
  }
  if (Buffer.byteLength(value, 'utf8') > limits.maxPathBytes) {
    throw new Error('Preview artifact path limit exceeded.');
  }
  const segments = value.split('/');
  if (segments.length > limits.maxPathSegments) {
    throw new Error('Preview artifact path segment limit exceeded.');
  }
  const collisionSegments = segments.map((segment) => {
    if (
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment.trim() !== segment ||
      segment.startsWith('.') ||
      segment.endsWith('.') ||
      Buffer.byteLength(segment, 'utf8') > limits.maxPathSegmentBytes ||
      !SEGMENT.test(segment) ||
      WINDOWS_RESERVED.test(segment) ||
      SENSITIVE.test(segment)
    ) {
      throw new Error('Unsafe preview artifact path segment.');
    }
    return segment.normalize('NFKC').toLocaleLowerCase('en-US');
  });
  const extension = path.posix.extname(value).toLocaleLowerCase('en-US');
  if (EXTENSION_MEDIA_TYPES[extension] !== mediaType) {
    throw new Error('Preview artifact media type mismatch.');
  }
  return Object.freeze({ value, collisionKey: collisionSegments.join('/') });
}

export function assertNoPreviewArtifactPathCollisions(
  paths: readonly SafePreviewArtifactPath[],
): void {
  const files = new Set<string>();
  for (const inspected of paths) {
    const segments = inspected.collisionKey.split('/');
    let prefix = '';
    for (const [index, segment] of segments.entries()) {
      prefix = prefix.length === 0 ? segment : `${prefix}/${segment}`;
      if (index < segments.length - 1 && files.has(prefix)) {
        throw new Error('Preview artifact file/directory collision.');
      }
    }
    if (files.has(inspected.collisionKey)) {
      throw new Error('Duplicate preview artifact path.');
    }
    for (const existing of files) {
      if (existing.startsWith(`${inspected.collisionKey}/`)) {
        throw new Error('Preview artifact file/directory collision.');
      }
    }
    files.add(inspected.collisionKey);
  }
}
