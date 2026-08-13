import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const WORKSPACE_ROOT = '/workspace/project';
export const BUILD_ROOT = '/tmp/brq-build';
export const WORKSPACE_MANIFEST = '/tmp/brq-workspace-manifest.json';
export const BUILD_MANIFEST = '/tmp/brq-build-manifest.json';
export const TYPESCRIPT_VERSION = '6.0.3';

const MAX_FILES = 96;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_BUNDLE_BYTES = 384 * 1024;
const MAX_PATH_BYTES = 512;
const MAX_PATH_SEGMENTS = 20;
const MAX_PATH_SEGMENT_BYTES = 255;
const MAX_TYPESCRIPT_DIAGNOSTIC_COUNT = 10_000;
const MAX_TYPESCRIPT_DIAGNOSTIC_CODES = 32;
const MAX_TYPESCRIPT_DIAGNOSTIC_CODE = 99_999;
const HASH = /^[a-f0-9]{64}$/u;
const WORKSPACE_ID = /^workspace-[a-f0-9]{32}$/u;
const SAFE_PATH_CHARACTERS = /^[A-Za-z0-9._/-]+$/u;
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu;
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
const require = createRequire(import.meta.url);

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function assertCondition(condition, code) {
  if (!condition) throw new Error(code);
}

export function assertExactKeys(value, expected, code) {
  assertCondition(value !== null && typeof value === 'object' && !Array.isArray(value), code);
  const actual = Object.keys(value).sort();
  const orderedExpected = [...expected].sort();
  assertCondition(JSON.stringify(actual) === JSON.stringify(orderedExpected), code);
}

export function parseWorkspaceArguments(arguments_) {
  assertCondition(
    arguments_.length === 2 && arguments_[0] === '--workspace' && arguments_[1] === WORKSPACE_ROOT,
    'INVALID_ARGUMENTS',
  );
  return WORKSPACE_ROOT;
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

export async function readStdin(maxBytes) {
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

export function validateEnvelope(raw) {
  assertExactKeys(raw, ['abi', 'workspaceId', 'workspaceHash', 'totalBytes', 'files'], 'ENVELOPE');
  assertCondition(raw.abi === 'brq.sandbox.workspace.v1', 'ABI');
  assertCondition(typeof raw.workspaceId === 'string' && WORKSPACE_ID.test(raw.workspaceId), 'ID');
  assertCondition(typeof raw.workspaceHash === 'string' && HASH.test(raw.workspaceHash), 'HASH');
  assertCondition(
    Number.isInteger(raw.totalBytes) && raw.totalBytes >= 0 && raw.totalBytes <= MAX_BUNDLE_BYTES,
    'TOTAL_BYTES',
  );
  assertCondition(
    Array.isArray(raw.files) && raw.files.length > 0 && raw.files.length <= MAX_FILES,
    'FILES',
  );

  const paths = new Set();
  const portablePaths = new Set();
  let totalBytes = 0;
  const files = raw.files.map((file) => {
    assertExactKeys(file, ['path', 'encoding', 'byteLength', 'contentHash', 'content'], 'FILE');
    const safePath = inspectSafePath(file.path);
    const collisionKey = portablePathKey(safePath);
    assertCondition(!paths.has(safePath), 'DUPLICATE_PATH');
    assertCondition(!portablePaths.has(collisionKey), 'PORTABLE_PATH_COLLISION');
    paths.add(safePath);
    portablePaths.add(collisionKey);
    assertCondition(file.encoding === 'BASE64', 'ENCODING');
    assertCondition(
      Number.isInteger(file.byteLength) &&
        file.byteLength >= 0 &&
        file.byteLength <= MAX_FILE_BYTES,
      'FILE_BYTES',
    );
    assertCondition(typeof file.contentHash === 'string' && HASH.test(file.contentHash), 'HASH');
    assertCondition(typeof file.content === 'string', 'CONTENT');
    const content = Buffer.from(file.content, 'base64');
    assertCondition(content.toString('base64') === file.content, 'BASE64');
    assertCondition(content.byteLength === file.byteLength, 'FILE_BYTES');
    assertCondition(sha256(content) === file.contentHash, 'FILE_HASH');
    totalBytes += content.byteLength;
    return Object.freeze({
      path: safePath,
      byteLength: file.byteLength,
      contentHash: file.contentHash,
      content,
    });
  });

  const orderedPaths = [...portablePaths].sort();
  for (let index = 0; index < orderedPaths.length; index += 1) {
    const current = orderedPaths[index];
    const next = orderedPaths[index + 1];
    assertCondition(next === undefined || !next.startsWith(`${current}/`), 'PATH_COLLISION');
  }
  assertCondition(totalBytes === raw.totalBytes && totalBytes <= MAX_BUNDLE_BYTES, 'TOTAL_BYTES');
  return Object.freeze({
    workspaceId: raw.workspaceId,
    workspaceHash: raw.workspaceHash,
    totalBytes,
    files: Object.freeze(files.sort((left, right) => left.path.localeCompare(right.path))),
  });
}

export function validateIntegrationPackage(content) {
  let packageDocument;
  try {
    packageDocument = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content));
  } catch {
    throw new Error('PACKAGE_JSON');
  }
  assertExactKeys(packageDocument, ['name', 'private'], 'PACKAGE_POLICY');
  assertCondition(
    typeof packageDocument.name === 'string' &&
      /^[a-z0-9][a-z0-9-]{0,63}$/u.test(packageDocument.name) &&
      packageDocument.private === true,
    'PACKAGE_POLICY',
  );
}

async function enumerateFiles(directory, root) {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    const relativePath = path.relative(root, target).split(path.sep).join('/');
    inspectSafePath(relativePath);
    assertCondition(!entry.isSymbolicLink(), 'WORKSPACE_SYMLINK');
    if (entry.isDirectory()) result.push(...(await enumerateFiles(target, root)));
    else {
      assertCondition(entry.isFile(), 'WORKSPACE_SPECIAL_FILE');
      result.push(relativePath);
    }
    assertCondition(result.length <= MAX_FILES, 'FILES');
  }
  return result.sort();
}

export async function verifyPreparedWorkspace() {
  const manifest = JSON.parse(await readFile(WORKSPACE_MANIFEST, 'utf8'));
  assertExactKeys(
    manifest,
    ['abi', 'workspaceId', 'workspaceHash', 'totalBytes', 'files'],
    'MANIFEST',
  );
  assertCondition(manifest.abi === 'brq.sandbox.workspace.manifest.v1', 'MANIFEST');
  assertCondition(
    typeof manifest.workspaceId === 'string' && WORKSPACE_ID.test(manifest.workspaceId),
    'MANIFEST',
  );
  assertCondition(
    typeof manifest.workspaceHash === 'string' && HASH.test(manifest.workspaceHash),
    'MANIFEST',
  );
  assertCondition(Array.isArray(manifest.files) && manifest.files.length > 0, 'MANIFEST');
  const canonicalRoot = await realpath(WORKSPACE_ROOT);
  assertCondition(canonicalRoot === WORKSPACE_ROOT, 'WORKSPACE_ALIAS');
  const observedPaths = await enumerateFiles(WORKSPACE_ROOT, WORKSPACE_ROOT);
  const expectedPaths = manifest.files.map((file) => file.path).sort();
  assertCondition(JSON.stringify(observedPaths) === JSON.stringify(expectedPaths), 'FILE_SET');

  let totalBytes = 0;
  for (const file of manifest.files) {
    assertExactKeys(file, ['path', 'byteLength', 'contentHash'], 'MANIFEST_FILE');
    const target = containedPath(WORKSPACE_ROOT, file.path);
    const metadata = await lstat(target);
    assertCondition(metadata.isFile() && !metadata.isSymbolicLink(), 'FILE_TYPE');
    assertCondition((await realpath(target)) === target, 'FILE_ALIAS');
    const content = await readFile(target);
    assertCondition(content.byteLength === file.byteLength, 'FILE_BYTES');
    assertCondition(sha256(content) === file.contentHash, 'FILE_HASH');
    totalBytes += content.byteLength;
  }
  assertCondition(totalBytes === manifest.totalBytes, 'TOTAL_BYTES');
  return Object.freeze(manifest);
}

export function sourceFilesFromManifest(manifest) {
  const sourceFiles = manifest.files
    .map((file) => file.path)
    .filter((filePath) => /(?:^|\/)src\/.*\.(?:cts|mts|ts)$/u.test(filePath));
  assertCondition(sourceFiles.length > 0, 'NO_TYPESCRIPT_SOURCE');
  return Object.freeze(sourceFiles.map((filePath) => containedPath(WORKSPACE_ROOT, filePath)));
}

export function loadTypeScript() {
  const typescript = require('/opt/brq/toolchain/typescript/lib/typescript.js');
  assertCondition(typescript.version === TYPESCRIPT_VERSION, 'TYPESCRIPT_VERSION');
  return typescript;
}

export function compilerOptions(typescript, additional = {}) {
  return Object.freeze({
    target: typescript.ScriptTarget.ES2022,
    module: typescript.ModuleKind.NodeNext,
    moduleResolution: typescript.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmitOnError: true,
    skipLibCheck: false,
    types: [],
    ...additional,
  });
}

export function assertNoDiagnostics(typescript, program) {
  const diagnostics = typescript.getPreEmitDiagnostics(program);
  if (diagnostics.length === 0) return;
  const observedCodes = diagnostics.map((diagnostic) => diagnostic.code);
  const validCodes = observedCodes.filter(
    (code) => Number.isInteger(code) && code > 0 && code <= MAX_TYPESCRIPT_DIAGNOSTIC_CODE,
  );
  const uniqueCodes = [...new Set(validCodes)].sort((left, right) => left - right);
  const error = new Error('TYPESCRIPT_DIAGNOSTICS');
  Object.defineProperty(error, 'diagnosticSummary', {
    value: Object.freeze({
      diagnosticCount: Math.min(diagnostics.length, MAX_TYPESCRIPT_DIAGNOSTIC_COUNT),
      diagnosticCodes: Object.freeze(uniqueCodes.slice(0, MAX_TYPESCRIPT_DIAGNOSTIC_CODES)),
      truncated:
        diagnostics.length > MAX_TYPESCRIPT_DIAGNOSTIC_COUNT ||
        uniqueCodes.length > MAX_TYPESCRIPT_DIAGNOSTIC_CODES ||
        validCodes.length !== observedCodes.length,
    }),
  });
  throw error;
}

export async function writeVerifiedFile(root, relativePath, content) {
  const target = containedPath(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, content, { flag: 'wx', mode: 0o600 });
  const metadata = await stat(target);
  assertCondition(metadata.isFile() && metadata.size === content.byteLength, 'WRITE_VERIFY');
  assertCondition(sha256(await readFile(target)) === sha256(content), 'WRITE_VERIFY');
}

export async function verifyBuildOutput() {
  const manifest = JSON.parse(await readFile(BUILD_MANIFEST, 'utf8'));
  assertExactKeys(manifest, ['abi', 'files'], 'BUILD_MANIFEST');
  assertCondition(manifest.abi === 'brq.sandbox.build.manifest.v1', 'BUILD_MANIFEST');
  assertCondition(Array.isArray(manifest.files) && manifest.files.length > 0, 'BUILD_MANIFEST');
  const observedPaths = await enumerateFiles(BUILD_ROOT, BUILD_ROOT);
  const expectedPaths = manifest.files.map((file) => file.path).sort();
  assertCondition(
    JSON.stringify(observedPaths) === JSON.stringify(expectedPaths),
    'BUILD_FILE_SET',
  );
  for (const file of manifest.files) {
    assertExactKeys(file, ['path', 'byteLength', 'contentHash'], 'BUILD_MANIFEST_FILE');
    const content = await readFile(containedPath(BUILD_ROOT, file.path));
    assertCondition(content.byteLength === file.byteLength, 'BUILD_FILE_BYTES');
    assertCondition(sha256(content) === file.contentHash, 'BUILD_FILE_HASH');
  }
  return Object.freeze(manifest);
}

export async function writeJsonFile(target, value) {
  await writeFile(target, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 });
}

export function reportSuccess(marker) {
  process.stdout.write(`${marker}\n`);
}

export async function runHelper(name, operation) {
  try {
    await operation();
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z0-9_]{2,64}$/u.test(error.message)
        ? error.message
        : 'UNEXPECTED';
    const diagnosticSummary =
      name === 'TYPECHECK' &&
      code === 'TYPESCRIPT_DIAGNOSTICS' &&
      error !== null &&
      typeof error === 'object' &&
      'diagnosticSummary' in error
        ? error.diagnosticSummary
        : null;
    if (
      diagnosticSummary !== null &&
      typeof diagnosticSummary === 'object' &&
      Number.isInteger(diagnosticSummary.diagnosticCount) &&
      diagnosticSummary.diagnosticCount > 0 &&
      diagnosticSummary.diagnosticCount <= MAX_TYPESCRIPT_DIAGNOSTIC_COUNT &&
      Array.isArray(diagnosticSummary.diagnosticCodes) &&
      diagnosticSummary.diagnosticCodes.length > 0 &&
      diagnosticSummary.diagnosticCodes.length <= MAX_TYPESCRIPT_DIAGNOSTIC_CODES &&
      diagnosticSummary.diagnosticCodes.length <= diagnosticSummary.diagnosticCount &&
      diagnosticSummary.diagnosticCodes.every(
        (diagnosticCode, index) =>
          Number.isInteger(diagnosticCode) &&
          diagnosticCode > 0 &&
          diagnosticCode <= MAX_TYPESCRIPT_DIAGNOSTIC_CODE &&
          (index === 0 || diagnosticCode > diagnosticSummary.diagnosticCodes[index - 1]),
      ) &&
      typeof diagnosticSummary.truncated === 'boolean'
    ) {
      process.stderr.write(
        `BRQ_${name}_DIAGNOSTICS count=${diagnosticSummary.diagnosticCount} codes=${diagnosticSummary.diagnosticCodes.join(',')} truncated=${diagnosticSummary.truncated}\n`,
      );
    }
    process.stderr.write(`BRQ_${name}_FAILED code=${code}\n`);
    process.exitCode = 1;
  }
}
