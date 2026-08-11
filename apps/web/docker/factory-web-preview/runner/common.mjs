import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import executionProfile from './execution-profile.snapshot.json' with { type: 'json' };

export const PROFILE_ID = executionProfile.profileId;
export const REQUIRED_ENTRYPOINT = executionProfile.rules.previewProjection.requiredEntrypoint;
export const REQUIRED_ENTRYPOINT_REASON = executionProfile.rules.files.requiredFilesRule.reasonCode;
export const REQUIRED_TEST_REASON = executionProfile.rules.testDiscovery.rule.reasonCode;
export const WORKSPACE_ROOT = '/workspace/project';
export const BUILD_ROOT = '/tmp/brq-web-build';
export const WORKSPACE_MANIFEST = '/tmp/brq-web-workspace-manifest.json';
export const BUILD_MANIFEST = '/tmp/brq-web-build-manifest.json';
export const NODE_TYPES = '/tmp/brq-web-node-types.d.ts';
export const TYPESCRIPT_VERSION = executionProfile.rules.buildSemantics.typeScriptVersion;
export const ARTIFACT_ABI_VERSION = '1.0.0';
export const ARTIFACT_EXPORTER_VERSION = '1.0.0';

const MAX_FILES = 96;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_WORKSPACE_BYTES = 384 * 1024;
export const MAX_ARTIFACT_FILES = 128;
export const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_PATH_BYTES = 512;
const MAX_PATH_SEGMENTS = 20;
const MAX_PATH_SEGMENT_BYTES = 255;
const HASH = /^[a-f0-9]{64}$/u;
const WORKSPACE_ID = /^workspace-[a-f0-9]{32}$/u;
const SAFE_PATH_CHARACTERS = /^[A-Za-z0-9._/-]+$/u;
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu;
const PROFILE_RULES = Object.freeze(executionProfile.rules);
const SOURCE_EXTENSIONS = new Set(PROFILE_RULES.sourceDiscovery.extensions);
const TEST_SUFFIXES = Object.freeze(PROFILE_RULES.testDiscovery.suffixes);
const STATIC_EXTENSIONS = new Set(PROFILE_RULES.previewProjection.staticExtensions);
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
const MEDIA_TYPES = Object.freeze({
  ...PROFILE_RULES.files.mediaTypes,
});
const require = createRequire(import.meta.url);

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

export function parseWorkspaceArguments(arguments_) {
  assertCondition(
    arguments_.length === 2 && arguments_[0] === '--workspace' && arguments_[1] === WORKSPACE_ROOT,
    'INVALID_ARGUMENTS',
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

function decodeText(content) {
  const value = new TextDecoder('utf-8', { fatal: true }).decode(content);
  assertCondition(!CONTROL_CHARACTERS.test(value), 'INVALID_TEXT');
  return value;
}

export function validateWorkspaceEnvelope(raw) {
  assertExactKeys(raw, ['abi', 'workspaceId', 'workspaceHash', 'totalBytes', 'files'], 'ENVELOPE');
  assertCondition(raw.abi === 'brq.sandbox.workspace.v1', 'ABI');
  assertCondition(typeof raw.workspaceId === 'string' && WORKSPACE_ID.test(raw.workspaceId), 'ID');
  assertCondition(typeof raw.workspaceHash === 'string' && HASH.test(raw.workspaceHash), 'HASH');
  assertCondition(
    Number.isInteger(raw.totalBytes) &&
      raw.totalBytes >= 0 &&
      raw.totalBytes <= MAX_WORKSPACE_BYTES,
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
    assertCondition(!paths.has(safePath) && !portablePaths.has(collisionKey), 'PATH_COLLISION');
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
    decodeText(content);
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
  assertCondition(totalBytes === raw.totalBytes, 'TOTAL_BYTES');
  return Object.freeze({
    workspaceId: raw.workspaceId,
    workspaceHash: raw.workspaceHash,
    totalBytes,
    files: Object.freeze(files.sort((left, right) => left.path.localeCompare(right.path))),
  });
}

export function validateOptionalPackage(content) {
  let document;
  try {
    document = JSON.parse(decodeText(content));
  } catch {
    throw new Error(PROFILE_RULES.packagePolicy.invalidJsonReasonCode);
  }
  assertCondition(
    document !== null && typeof document === 'object' && !Array.isArray(document),
    PROFILE_RULES.packagePolicy.rule.reasonCode,
  );
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'scripts',
  ]) {
    const value = document[field];
    assertCondition(
      value === undefined ||
        (typeof value === 'object' && value !== null && Object.keys(value).length === 0),
      PROFILE_RULES.packagePolicy.rule.reasonCode,
    );
  }
  assertCondition(
    document.type === undefined || document.type === PROFILE_RULES.packagePolicy.type,
    PROFILE_RULES.packagePolicy.rule.reasonCode,
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
    assertCondition(result.length <= MAX_ARTIFACT_FILES, 'FILES');
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
  assertCondition(manifest.abi === 'brq.sandbox.web-workspace.manifest.v1', 'MANIFEST');
  assertCondition(
    typeof manifest.workspaceId === 'string' && WORKSPACE_ID.test(manifest.workspaceId),
    'MANIFEST',
  );
  assertCondition(
    typeof manifest.workspaceHash === 'string' && HASH.test(manifest.workspaceHash),
    'MANIFEST',
  );
  assertCondition(Array.isArray(manifest.files) && manifest.files.length > 0, 'MANIFEST');
  assertCondition((await realpath(WORKSPACE_ROOT)) === WORKSPACE_ROOT, 'WORKSPACE_ALIAS');
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
    decodeText(content);
    totalBytes += content.byteLength;
  }
  assertCondition(totalBytes === manifest.totalBytes, 'TOTAL_BYTES');
  return Object.freeze(manifest);
}

export function sourcePathsFromManifest(manifest) {
  const sources = manifest.files
    .map((file) => file.path)
    .filter(
      (filePath) =>
        SOURCE_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase()) &&
        !PROFILE_RULES.sourceDiscovery.excludedSuffixes.some((suffix) => filePath.endsWith(suffix)),
    );
  assertCondition(sources.length > 0, PROFILE_RULES.sourceDiscovery.rule.reasonCode);
  assertCondition(
    manifest.files.every((file) => {
      const extension = path.posix.extname(file.path).toLowerCase();
      return (
        PROFILE_RULES.files.allowedExtensions.includes(extension) &&
        !PROFILE_RULES.files.forbiddenExtensions.includes(extension)
      );
    }),
    PROFILE_RULES.files.rule.reasonCode,
  );
  return Object.freeze(sources);
}

export function testPathsFromSources(sources) {
  const tests = sources.filter((filePath) =>
    TEST_SUFFIXES.some((suffix) => filePath.endsWith(suffix)),
  );
  assertCondition(tests.length > 0, PROFILE_RULES.testDiscovery.rule.reasonCode);
  return Object.freeze(tests);
}

export function isTestPath(filePath) {
  return TEST_SUFFIXES.some((suffix) => filePath.endsWith(suffix));
}

export function loadTypeScript() {
  const typescript = require('/opt/brq/toolchain/typescript/lib/typescript.js');
  assertCondition(typescript.version === TYPESCRIPT_VERSION, 'TYPESCRIPT_VERSION');
  return typescript;
}

export async function compilerRootNames(manifest) {
  const sources = sourcePathsFromManifest(manifest);
  const declarations = [
    "declare module 'node:test' { type TestBody = () => void | Promise<void>; export function test(name: string, body: TestBody): void; export default test; }",
    "declare module 'node:assert' { interface Assert { ok(value: unknown, message?: string): asserts value; equal(actual: unknown, expected: unknown, message?: string): void; deepEqual(actual: unknown, expected: unknown, message?: string): void; strictEqual(actual: unknown, expected: unknown, message?: string): void; throws(body: () => unknown): void; } const assert: Assert; export = assert; }",
    "declare module 'node:assert/strict' { import assert = require('node:assert'); export = assert; }",
  ].join('\n');
  await writeFile(NODE_TYPES, `${declarations}\n`, { flag: 'w', mode: 0o600 });
  return Object.freeze([
    ...sources.map((filePath) => containedPath(WORKSPACE_ROOT, filePath)),
    NODE_TYPES,
  ]);
}

export function compilerOptions(typescript, additional = {}) {
  const target = typescript.ScriptTarget[PROFILE_RULES.buildSemantics.target];
  const moduleKind = typescript.ModuleKind[PROFILE_RULES.buildSemantics.module];
  assertCondition(target !== undefined && moduleKind !== undefined, 'TYPESCRIPT_VERSION');
  return Object.freeze({
    target,
    module: moduleKind,
    moduleResolution: typescript.ModuleResolutionKind.Bundler,
    strict: PROFILE_RULES.buildSemantics.strict,
    allowJs: PROFILE_RULES.buildSemantics.allowJavaScript,
    checkJs: PROFILE_RULES.buildSemantics.checkJavaScript,
    esModuleInterop: true,
    noEmitOnError: true,
    skipLibCheck: false,
    types: [],
    ...additional,
  });
}

export function assertNoDiagnostics(typescript, program) {
  assertCondition(typescript.getPreEmitDiagnostics(program).length === 0, 'TYPESCRIPT_DIAGNOSTICS');
}

export async function writeVerifiedFile(root, relativePath, content) {
  const target = containedPath(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, content, { flag: 'wx', mode: 0o600 });
  const metadata = await stat(target);
  assertCondition(metadata.isFile() && metadata.size === content.byteLength, 'WRITE_VERIFY');
  assertCondition(sha256(await readFile(target)) === sha256(content), 'WRITE_VERIFY');
}

function assertRelativeReference(value, reasonCode) {
  const normalized = value.trim();
  assertCondition(
    normalized.length > 0 &&
      !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/iu.test(normalized) &&
      !normalized.includes('\\') &&
      !normalized.split(/[?#]/u, 1)[0].split('/').includes('..'),
    reasonCode,
  );
}

function usesBrowserCapability(content, capability) {
  const expressions = Object.freeze({
    EventSource: /\bEventSource\s*\(/u,
    SharedWorker: /\bSharedWorker\s*\(/u,
    WebSocket: /\bWebSocket\s*\(/u,
    Worker: /\bWorker\s*\(/u,
    eval: /\beval\s*\(/u,
    importScripts: /\bimportScripts\s*\(/u,
    'navigator.sendBeacon': /\bnavigator\.sendBeacon\s*\(/u,
    'navigator.serviceWorker': /\bnavigator\.serviceWorker\b/u,
    'new Function': /\bnew\s+Function\s*\(/u,
  });
  return expressions[capability]?.test(content) ?? false;
}

export function validatePreviewSource(filePath, content) {
  const text = decodeText(content);
  if (filePath.endsWith('.json')) {
    try {
      JSON.parse(text);
    } catch {
      throw new Error(PROFILE_RULES.contentRules.json.rule.reasonCode);
    }
  }
  if (filePath.endsWith('.html')) {
    const forbiddenElements = PROFILE_RULES.contentRules.html.forbiddenElements.join('|');
    assertCondition(
      !new RegExp(`<(?:${forbiddenElements})\\b`, 'iu').test(text),
      PROFILE_RULES.contentRules.html.elementsRule.reasonCode,
    );
    const attributePrefixes = PROFILE_RULES.contentRules.html.forbiddenAttributePrefixes.join('|');
    const forbiddenAttributes = PROFILE_RULES.contentRules.html.forbiddenAttributes.join('|');
    assertCondition(
      !new RegExp(
        `\\s(?:${attributePrefixes})[a-z]+\\s*=|\\s(?:${forbiddenAttributes})\\s*=`,
        'iu',
      ).test(text),
      PROFILE_RULES.contentRules.html.inlineActiveRule.reasonCode,
    );
    assertCondition(
      !PROFILE_RULES.contentRules.html.forbidStyleElement || !/<style\b/iu.test(text),
      PROFILE_RULES.contentRules.html.inlineActiveRule.reasonCode,
    );
    assertCondition(
      !PROFILE_RULES.contentRules.html.forbidInlineScript ||
        !/<script\b(?![^>]*\bsrc\s*=)[^>]*>/iu.test(text),
      PROFILE_RULES.contentRules.html.inlineActiveRule.reasonCode,
    );
    const referenceAttributes = PROFILE_RULES.contentRules.html.referenceAttributes.join('|');
    const referenceExpression = new RegExp(
      `\\b(?:${referenceAttributes})\\s*=\\s*["']([^"']+)["']`,
      'giu',
    );
    for (const match of text.matchAll(referenceExpression)) {
      assertRelativeReference(match[1], PROFILE_RULES.contentRules.html.referencesRule.reasonCode);
    }
  }
  if (SOURCE_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase())) {
    assertCondition(
      !/\b(?:require\s*\(|module\.exports\b|exports\.[A-Za-z_$])/u.test(text),
      PROFILE_RULES.modulePolicy.formatRule.reasonCode,
    );
    const allowedRelativeExtensions = new Set(PROFILE_RULES.modulePolicy.relativeImportExtensions);
    const allowedTestBareImports = new Set(PROFILE_RULES.modulePolicy.allowedTestBareImports);
    const importedSpecifiers = [
      ...text.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
      ...text.matchAll(/\bimport\s+["']([^"']+)["']/gu),
      ...text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu),
    ].map((match) => match[1]);
    assertCondition(
      importedSpecifiers.every((specifier) => {
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
          return allowedRelativeExtensions.has(path.posix.extname(specifier).toLowerCase());
        }
        return isTestPath(filePath) && allowedTestBareImports.has(specifier);
      }),
      PROFILE_RULES.modulePolicy.importRule.reasonCode,
    );
  }
  if (SOURCE_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase()) && !isTestPath(filePath)) {
    assertCondition(
      !PROFILE_RULES.contentRules.javaScript.forbiddenCapabilities.some((capability) =>
        usesBrowserCapability(text, capability),
      ),
      PROFILE_RULES.contentRules.javaScript.capabilitiesRule.reasonCode,
    );
    if (PROFILE_RULES.contentRules.javaScript.relativeImportsOnly) {
      for (const match of text.matchAll(/(?:\bfrom\s+|\bimport\s*\()\s*["']([^"']+)["']/gu)) {
        assertRelativeReference(
          match[1],
          PROFILE_RULES.contentRules.javaScript.referencesRule.reasonCode,
        );
      }
    }
    if (PROFILE_RULES.contentRules.javaScript.relativeFetchOnly) {
      for (const match of text.matchAll(/\bfetch\s*\(\s*["']([^"']+)["']/gu)) {
        assertRelativeReference(
          match[1],
          PROFILE_RULES.contentRules.javaScript.referencesRule.reasonCode,
        );
      }
    }
  }
  if (filePath.endsWith('.css')) {
    assertCondition(
      !PROFILE_RULES.contentRules.css.forbidImport || !/@import\b/iu.test(text),
      PROFILE_RULES.contentRules.css.importRule.reasonCode,
    );
    if (PROFILE_RULES.contentRules.css.relativeUrlsOnly) {
      for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/giu)) {
        assertRelativeReference(match[1], PROFILE_RULES.contentRules.css.urlsRule.reasonCode);
      }
    }
  }
}

export function validateExecutionProfileFiles(files) {
  const manifest = { files };
  const sources = sourcePathsFromManifest(manifest);
  const tests = testPathsFromSources(sources);
  assertCondition(
    PROFILE_RULES.files.requiredFiles.every((requiredPath) =>
      files.some((file) => file.path === requiredPath),
    ),
    PROFILE_RULES.files.requiredFilesRule.reasonCode,
  );
  for (const file of files) {
    const expectedMediaType = MEDIA_TYPES[path.posix.extname(file.path).toLowerCase()];
    if (file.mediaType !== undefined) {
      assertCondition(file.mediaType === expectedMediaType, PROFILE_RULES.files.rule.reasonCode);
    }
    if (file.path === PROFILE_RULES.packagePolicy.path) validateOptionalPackage(file.content);
    validatePreviewSource(file.path, file.content);
  }
  return Object.freeze({ sources, tests });
}

export function mediaTypeFor(filePath) {
  const mediaType = MEDIA_TYPES[path.posix.extname(filePath).toLowerCase()];
  assertCondition(typeof mediaType === 'string', 'UNSUPPORTED_PREVIEW_FILE');
  return mediaType;
}

export function staticPathsFromManifest(manifest) {
  return manifest.files
    .map((file) => file.path)
    .filter(
      (filePath) =>
        filePath !== PROFILE_RULES.packagePolicy.path &&
        STATIC_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase()) &&
        !isTestPath(filePath),
    )
    .sort();
}

export async function verifyBuildOutput() {
  const manifest = JSON.parse(await readFile(BUILD_MANIFEST, 'utf8'));
  assertExactKeys(
    manifest,
    ['abi', 'profileId', 'workspaceId', 'workspaceHash', 'files'],
    'BUILD_MANIFEST',
  );
  assertCondition(manifest.abi === 'brq.sandbox.web-build.manifest.v1', 'BUILD_MANIFEST');
  assertCondition(manifest.profileId === PROFILE_ID, 'BUILD_MANIFEST');
  assertCondition(
    typeof manifest.workspaceId === 'string' && WORKSPACE_ID.test(manifest.workspaceId),
    'BUILD_MANIFEST',
  );
  assertCondition(
    typeof manifest.workspaceHash === 'string' && HASH.test(manifest.workspaceHash),
    'BUILD_MANIFEST',
  );
  assertCondition(Array.isArray(manifest.files) && manifest.files.length > 0, 'BUILD_MANIFEST');
  const observedPaths = await enumerateFiles(BUILD_ROOT, BUILD_ROOT);
  const expectedPaths = manifest.files.map((file) => file.path).sort();
  assertCondition(
    JSON.stringify(observedPaths) === JSON.stringify(expectedPaths),
    'BUILD_FILE_SET',
  );
  let totalBytes = 0;
  for (const file of manifest.files) {
    assertExactKeys(
      file,
      ['path', 'mediaType', 'visibility', 'byteLength', 'contentHash'],
      'BUILD_MANIFEST_FILE',
    );
    const content = await readFile(containedPath(BUILD_ROOT, file.path));
    assertCondition(content.byteLength === file.byteLength, 'BUILD_FILE_BYTES');
    assertCondition(sha256(content) === file.contentHash, 'BUILD_FILE_HASH');
    assertCondition(
      file.visibility === 'PREVIEW' || file.visibility === 'TEST',
      'BUILD_VISIBILITY',
    );
    if (file.visibility === 'PREVIEW') {
      assertCondition(mediaTypeFor(file.path) === file.mediaType, 'BUILD_MEDIA_TYPE');
      validatePreviewSource(file.path, content);
      totalBytes += content.byteLength;
    }
  }
  assertCondition(totalBytes <= MAX_ARTIFACT_BYTES, 'ARTIFACT_BYTES');
  return Object.freeze(manifest);
}

export function calculateArtifactContentHash(files) {
  const projection = {
    profileId: PROFILE_ID,
    files: files.map(({ path: filePath, mediaType, byteLength, contentHash }) => ({
      path: filePath,
      mediaType,
      byteLength,
      contentHash,
    })),
  };
  return sha256(`brq.preview.artifact.content.v1\n${JSON.stringify(projection)}`);
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
    process.stderr.write(`BRQ_${name}_FAILED code=${code}\n`);
    process.exitCode = 1;
  }
}
