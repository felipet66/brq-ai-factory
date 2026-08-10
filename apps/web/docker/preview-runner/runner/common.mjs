import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PROFILE_ID = 'NODE_WEB_PREVIEW_24_V1';
export const ARTIFACT_ABI_VERSION = '1.0.0';
export const ARTIFACT_EXPORTER_VERSION = '1.0.0';
export const SITE_ROOT = '/preview/site';
export const ARTIFACT_MANIFEST = '/preview/artifact-manifest.json';
export const INTERNAL_PORT = 8080;
export const HEALTH_PATH = '/__brq/health';
export const HEALTH_BODY = 'BRQ_PREVIEW_HEALTHY';

const MAX_INPUT_BYTES = 1536 * 1024;
const MAX_FILES = 128;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const MAX_PATH_BYTES = 512;
const MAX_PATH_SEGMENTS = 20;
const MAX_PATH_SEGMENT_BYTES = 255;
const HASH = /^[a-f0-9]{64}$/u;
const SAFE_PATH_CHARACTERS = /^[A-Za-z0-9._/-]+$/u;
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const SENSITIVE_SEGMENTS = new Set([
  '.env',
  '.git',
  '.npmrc',
  '.ssh',
  'credentials',
  'node_modules',
  'private-key',
  'private_key',
  'secret',
  'secrets',
]);
export const MEDIA_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'text/xml; charset=utf-8',
});

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function assertCondition(condition, code) {
  if (!condition) throw new Error(code);
}

export function assertExactKeys(value, expected, code) {
  assertCondition(value !== null && typeof value === 'object' && !Array.isArray(value), code);
  assertCondition(
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()),
    code,
  );
}

export function inspectSafePath(candidate) {
  assertCondition(
    typeof candidate === 'string' &&
      candidate.length > 0 &&
      candidate.trim() === candidate &&
      candidate.normalize('NFC') === candidate &&
      Buffer.byteLength(candidate, 'utf8') <= MAX_PATH_BYTES &&
      SAFE_PATH_CHARACTERS.test(candidate) &&
      !candidate.startsWith('/') &&
      !candidate.endsWith('/') &&
      !candidate.includes('//') &&
      !candidate.includes('\\') &&
      path.posix.normalize(candidate) === candidate,
    'UNSAFE_PATH',
  );
  const segments = candidate.split('/');
  assertCondition(
    segments.length <= MAX_PATH_SEGMENTS &&
      segments.every((segment) => {
        const collisionSegment = segment.normalize('NFKC').toLowerCase();
        return (
          segment !== '.' &&
          segment !== '..' &&
          !segment.startsWith('.') &&
          !segment.endsWith('.') &&
          !WINDOWS_RESERVED_NAME.test(collisionSegment) &&
          !SENSITIVE_SEGMENTS.has(collisionSegment) &&
          Buffer.byteLength(segment, 'utf8') <= MAX_PATH_SEGMENT_BYTES
        );
      }),
    'UNSAFE_PATH',
  );
  return candidate;
}

function portablePathKey(candidate) {
  return candidate
    .split('/')
    .map((segment) => segment.normalize('NFKC').toLowerCase())
    .join('/');
}

export function containedPath(root, relativePath) {
  const safePath = inspectSafePath(relativePath);
  const target = path.resolve(root, ...safePath.split('/'));
  assertCondition(target.startsWith(`${root}${path.sep}`), 'PATH_ESCAPE');
  return target;
}

export async function readStdin(maxBytes = MAX_INPUT_BYTES) {
  const chunks = [];
  let observedBytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    observedBytes += buffer.byteLength;
    assertCondition(observedBytes <= maxBytes, 'STDIN_LIMIT');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function validateText(content) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  assertCondition(!CONTROL_CHARACTERS.test(text), 'INVALID_TEXT');
}

function artifactProjection(files) {
  return {
    profileId: PROFILE_ID,
    files: files.map(({ path: filePath, mediaType, byteLength, contentHash }) => ({
      path: filePath,
      mediaType,
      byteLength,
      contentHash,
    })),
  };
}

export function calculateArtifactContentHash(files) {
  return sha256(`brq.preview.artifact.content.v1\n${JSON.stringify(artifactProjection(files))}`);
}

export function validateArtifactEnvelope(raw) {
  assertExactKeys(raw, ['abiVersion', 'profileId', 'exporterVersion', 'files'], 'ENVELOPE');
  assertCondition(raw.abiVersion === ARTIFACT_ABI_VERSION, 'ABI');
  assertCondition(raw.profileId === PROFILE_ID, 'PROFILE');
  assertCondition(raw.exporterVersion === ARTIFACT_EXPORTER_VERSION, 'EXPORTER');
  assertCondition(
    Array.isArray(raw.files) && raw.files.length > 0 && raw.files.length <= MAX_FILES,
    'FILES',
  );
  const paths = new Set();
  const portablePaths = new Set();
  let totalBytes = 0;
  const files = raw.files.map((file) => {
    assertExactKeys(file, ['path', 'content', 'mediaType'], 'FILE');
    const safePath = inspectSafePath(file.path);
    const collisionKey = portablePathKey(safePath);
    assertCondition(!paths.has(safePath) && !portablePaths.has(collisionKey), 'PATH_COLLISION');
    paths.add(safePath);
    portablePaths.add(collisionKey);
    const extension = path.posix.extname(safePath).toLowerCase();
    const expectedMediaType = MEDIA_TYPES[extension]?.split(';', 1)[0];
    assertCondition(
      typeof expectedMediaType === 'string' && file.mediaType === expectedMediaType,
      'MEDIA_TYPE',
    );
    assertCondition(typeof file.content === 'string', 'CONTENT');
    const content = Buffer.from(file.content, 'utf8');
    assertCondition(content.toString('utf8') === file.content, 'CONTENT');
    assertCondition(content.byteLength <= MAX_FILE_BYTES, 'FILE_BYTES');
    validateText(content);
    totalBytes += content.byteLength;
    return Object.freeze({
      path: safePath,
      mediaType: file.mediaType,
      byteLength: content.byteLength,
      contentHash: sha256(content),
      content,
    });
  });
  files.sort((left, right) => left.path.localeCompare(right.path));
  const orderedPaths = [...portablePaths].sort();
  for (let index = 0; index < orderedPaths.length; index += 1) {
    const current = orderedPaths[index];
    const next = orderedPaths[index + 1];
    assertCondition(next === undefined || !next.startsWith(`${current}/`), 'PATH_COLLISION');
  }
  assertCondition(
    files.some((file) => file.path === 'index.html'),
    'INDEX_HTML_REQUIRED',
  );
  assertCondition(totalBytes > 0 && totalBytes <= MAX_TOTAL_BYTES, 'TOTAL_BYTES');
  return Object.freeze({
    exporterVersion: raw.exporterVersion,
    artifactContentHash: calculateArtifactContentHash(files),
    totalBytes,
    files: Object.freeze(files),
  });
}

async function enumerateFiles(directory, root) {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    const relativePath = path.relative(root, target).split(path.sep).join('/');
    inspectSafePath(relativePath);
    assertCondition(!entry.isSymbolicLink(), 'SITE_SYMLINK');
    if (entry.isDirectory()) result.push(...(await enumerateFiles(target, root)));
    else {
      assertCondition(entry.isFile(), 'SITE_SPECIAL_FILE');
      result.push(relativePath);
    }
    assertCondition(result.length <= MAX_FILES, 'FILES');
  }
  return result.sort();
}

export async function writeVerifiedFile(relativePath, content) {
  const target = containedPath(SITE_ROOT, relativePath);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, content, { flag: 'wx', mode: 0o600 });
  const metadata = await stat(target);
  assertCondition(metadata.isFile() && metadata.size === content.byteLength, 'WRITE_VERIFY');
  assertCondition(sha256(await readFile(target)) === sha256(content), 'WRITE_VERIFY');
}

export async function verifyPreparedSite() {
  const manifest = JSON.parse(await readFile(ARTIFACT_MANIFEST, 'utf8'));
  assertExactKeys(
    manifest,
    ['abi', 'profileId', 'exporterVersion', 'artifactContentHash', 'totalBytes', 'files'],
    'MANIFEST',
  );
  assertCondition(manifest.abi === 'brq.preview.runtime.manifest.v1', 'MANIFEST');
  assertCondition(manifest.profileId === PROFILE_ID, 'MANIFEST');
  assertCondition(manifest.exporterVersion === ARTIFACT_EXPORTER_VERSION, 'MANIFEST');
  assertCondition(
    typeof manifest.artifactContentHash === 'string' && HASH.test(manifest.artifactContentHash),
    'MANIFEST',
  );
  assertCondition(Number.isInteger(manifest.totalBytes) && manifest.totalBytes > 0, 'MANIFEST');
  assertCondition(Array.isArray(manifest.files) && manifest.files.length > 0, 'MANIFEST');
  assertCondition((await realpath(SITE_ROOT)) === SITE_ROOT, 'SITE_ALIAS');
  const observedPaths = await enumerateFiles(SITE_ROOT, SITE_ROOT);
  const expectedPaths = manifest.files.map((file) => file.path).sort();
  assertCondition(JSON.stringify(observedPaths) === JSON.stringify(expectedPaths), 'FILE_SET');
  let totalBytes = 0;
  for (const file of manifest.files) {
    assertExactKeys(file, ['path', 'mediaType', 'byteLength', 'contentHash'], 'MANIFEST_FILE');
    const target = containedPath(SITE_ROOT, file.path);
    const metadata = await lstat(target);
    assertCondition(metadata.isFile() && !metadata.isSymbolicLink(), 'FILE_TYPE');
    assertCondition((await realpath(target)) === target, 'FILE_ALIAS');
    const content = await readFile(target);
    assertCondition(content.byteLength === file.byteLength, 'FILE_BYTES');
    assertCondition(sha256(content) === file.contentHash, 'FILE_HASH');
    validateText(content);
    totalBytes += content.byteLength;
  }
  assertCondition(
    totalBytes === manifest.totalBytes && totalBytes <= MAX_TOTAL_BYTES,
    'TOTAL_BYTES',
  );
  assertCondition(
    calculateArtifactContentHash(manifest.files) === manifest.artifactContentHash,
    'ARTIFACT_HASH',
  );
  return Object.freeze(manifest);
}

export async function runHelper(name, operation) {
  try {
    await operation();
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z0-9_]{2,64}$/u.test(error.message)
        ? error.message
        : 'UNEXPECTED';
    process.stderr.write(`BRQ_PREVIEW_${name}_FAILED code=${code}\n`);
    process.exitCode = 1;
  }
}
