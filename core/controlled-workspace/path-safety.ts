import path from 'node:path';

import type { ControlledWorkspaceLimits } from './limits';

const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/u;
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:/u;
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu;
const ALLOWED_SEGMENT_CHARACTERS = /^[\p{L}\p{N}_@+.,()\[\]{}-]+$/u;
const SENSITIVE_SEGMENT_PATTERN =
  /^(?:credential|credentials|secret|secrets|private-key|private_key|git-credentials|authorized_keys|known_hosts|id_(?:rsa|dsa|ecdsa|ed25519))(?:\..*)?$/iu;
const SENSITIVE_SEGMENTS = new Set([
  '.env',
  '.git',
  '.npmrc',
  '.netrc',
  '.ssh',
  'authorized_keys',
  'credentials',
  'credentials.json',
  'id_dsa',
  'id_ed25519',
  'id_ecdsa',
  'id_rsa',
  'known_hosts',
  'node_modules',
  'private-key',
  'private_key',
  'secret',
  'secrets',
  'secrets.json',
]);

export const CONTROLLED_WORKSPACE_MEDIA_TYPES = Object.freeze([
  'application/json',
  'application/sql',
  'application/yaml',
  'text/css',
  'text/html',
  'text/javascript',
  'text/markdown',
  'text/plain',
  'text/typescript',
  'text/xml',
  'text/x-prisma',
] as const);

export type ControlledWorkspaceMediaType = (typeof CONTROLLED_WORKSPACE_MEDIA_TYPES)[number];

const EXTENSION_MEDIA_TYPES: Readonly<Record<string, ControlledWorkspaceMediaType>> = Object.freeze(
  {
    '.cjs': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.jsx': 'text/javascript',
    '.md': 'text/markdown',
    '.mjs': 'text/javascript',
    '.prisma': 'text/x-prisma',
    '.sql': 'application/sql',
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript',
    '.txt': 'text/plain',
    '.xml': 'text/xml',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml',
  },
);

export type PathSafetyFailureReason =
  | 'ABSOLUTE_PATH'
  | 'BACKSLASH'
  | 'CONTROL_CHARACTER'
  | 'DRIVE_PATH'
  | 'EMPTY_PATH'
  | 'HIDDEN_SEGMENT'
  | 'INVALID_SEGMENT'
  | 'NON_NFC'
  | 'PATH_LIMIT'
  | 'RESERVED_NAME'
  | 'SENSITIVE_SEGMENT'
  | 'TRAVERSAL'
  | 'UNSUPPORTED_EXTENSION'
  | 'MEDIA_TYPE_MISMATCH';

export class PathSafetyFailure extends Error {
  readonly reason: PathSafetyFailureReason;

  constructor(reason: PathSafetyFailureReason) {
    super('O caminho do arquivo não é permitido pelo workspace controlado.');
    this.name = 'PathSafetyFailure';
    this.reason = reason;
  }
}

export interface SafeWorkspacePath {
  readonly value: string;
  readonly collisionKey: string;
  readonly segmentCollisionKeys: readonly string[];
  readonly byteLength: number;
}

function assertSegment(segment: string, limits: ControlledWorkspaceLimits): string {
  if (segment === '' || segment === '.' || segment === '..') {
    throw new PathSafetyFailure('TRAVERSAL');
  }
  if (segment.trim() !== segment || CONTROL_CHARACTER.test(segment)) {
    throw new PathSafetyFailure('INVALID_SEGMENT');
  }
  if (Buffer.byteLength(segment, 'utf8') > limits.maxPathSegmentBytes) {
    throw new PathSafetyFailure('PATH_LIMIT');
  }
  if (!ALLOWED_SEGMENT_CHARACTERS.test(segment)) {
    throw new PathSafetyFailure('INVALID_SEGMENT');
  }

  const collisionSegment = segment.normalize('NFKC').toLocaleLowerCase('en-US');
  if (
    collisionSegment === '' ||
    collisionSegment === '.' ||
    collisionSegment === '..' ||
    collisionSegment.includes('/') ||
    collisionSegment.includes('\\')
  ) {
    throw new PathSafetyFailure('TRAVERSAL');
  }
  if (segment.startsWith('.') || collisionSegment.startsWith('.')) {
    throw new PathSafetyFailure('HIDDEN_SEGMENT');
  }
  if (WINDOWS_RESERVED_NAME.test(collisionSegment)) {
    throw new PathSafetyFailure('RESERVED_NAME');
  }
  if (
    SENSITIVE_SEGMENTS.has(collisionSegment) ||
    SENSITIVE_SEGMENT_PATTERN.test(collisionSegment)
  ) {
    throw new PathSafetyFailure('SENSITIVE_SEGMENT');
  }
  if (segment.endsWith('.') || segment.endsWith(' ')) {
    throw new PathSafetyFailure('INVALID_SEGMENT');
  }

  return collisionSegment;
}

export function inspectSafeWorkspacePath(
  value: string,
  mediaType: ControlledWorkspaceMediaType,
  limits: ControlledWorkspaceLimits,
): SafeWorkspacePath {
  if (value.length === 0 || value.trim() !== value) throw new PathSafetyFailure('EMPTY_PATH');
  if (value !== value.normalize('NFC')) throw new PathSafetyFailure('NON_NFC');
  if (CONTROL_CHARACTER.test(value)) throw new PathSafetyFailure('CONTROL_CHARACTER');
  if (value.includes('\\')) throw new PathSafetyFailure('BACKSLASH');
  if (WINDOWS_DRIVE_PATH.test(value)) throw new PathSafetyFailure('DRIVE_PATH');
  if (value.startsWith('//') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new PathSafetyFailure('ABSOLUTE_PATH');
  }

  const segments = value.split('/');
  if (
    segments.length > limits.maxPathSegments ||
    Buffer.byteLength(value, 'utf8') > limits.maxPathBytes
  ) {
    throw new PathSafetyFailure('PATH_LIMIT');
  }
  const collisionSegments = segments.map((segment) => assertSegment(segment, limits));
  const filename = collisionSegments.at(-1);
  const extension = filename === undefined ? '' : path.posix.extname(filename);
  const expectedMediaType = EXTENSION_MEDIA_TYPES[extension];
  if (expectedMediaType === undefined) throw new PathSafetyFailure('UNSUPPORTED_EXTENSION');
  if (expectedMediaType !== mediaType) throw new PathSafetyFailure('MEDIA_TYPE_MISMATCH');

  return Object.freeze({
    value,
    collisionKey: collisionSegments.join('/'),
    segmentCollisionKeys: Object.freeze(collisionSegments),
    byteLength: Buffer.byteLength(value, 'utf8'),
  });
}

export function assertNoWorkspacePathCollisions(paths: readonly SafeWorkspacePath[]): void {
  const occupiedFiles = new Set<string>();
  for (const inspected of paths) {
    if (occupiedFiles.has(inspected.collisionKey)) {
      throw new PathSafetyFailure('INVALID_SEGMENT');
    }
    occupiedFiles.add(inspected.collisionKey);
  }

  for (const inspected of paths) {
    const segments = inspected.segmentCollisionKeys;
    for (let index = 1; index < segments.length; index += 1) {
      if (occupiedFiles.has(segments.slice(0, index).join('/'))) {
        throw new PathSafetyFailure('INVALID_SEGMENT');
      }
    }
  }
}

export function resolveContainedWorkspacePath(root: string, relativePath: string): string {
  const candidate = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new PathSafetyFailure('TRAVERSAL');
  }
  return candidate;
}
