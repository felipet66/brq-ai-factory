import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical-json';
import { immutableClone } from './immutability';
import {
  FACTORY_EXECUTION_PROFILE_REASON_CODES as REASONS,
  FACTORY_EXECUTION_PROFILE_RULE_IDS as RULES,
  factoryExecutionProfileDescriptorSchema,
  factoryExecutionProfileSchema,
  type FactoryExecutionProfile,
  type FactoryExecutionProfileDescriptor,
} from './schemas';

function domainHash(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(`${domain}\u0000${canonicalJson(value)}`)
    .digest('hex');
}

export function calculateFactoryExecutionProfileHash(
  descriptor: FactoryExecutionProfileDescriptor,
): string {
  return domainHash('brq-factory-execution-profile:profile:v1', descriptor);
}

export function createFactoryExecutionProfile(
  rawDescriptor: FactoryExecutionProfileDescriptor,
): FactoryExecutionProfile {
  const descriptor = factoryExecutionProfileDescriptorSchema.parse(rawDescriptor);
  return immutableClone(
    factoryExecutionProfileSchema.parse({
      ...descriptor,
      identity: {
        ...descriptor.identity,
        profileHash: calculateFactoryExecutionProfileHash(descriptor),
      },
    }),
  );
}

const PREPARE_REASON_CODES = Object.freeze([
  REASONS.UNSUPPORTED_SOURCE_PROFILE,
  REASONS.NO_SUPPORTED_SOURCE,
  REASONS.NO_TEST_FILES,
  REASONS.INDEX_HTML_REQUIRED,
  REASONS.DEPENDENCY_UNSUPPORTED,
  REASONS.PACKAGE_JSON,
  REASONS.PACKAGE_POLICY,
  REASONS.UNSUPPORTED_HTML,
  REASONS.INLINE_ACTIVE_CONTENT,
  REASONS.EXTERNAL_OR_UNSAFE_REFERENCE,
  REASONS.UNSUPPORTED_CSS,
  REASONS.UNSUPPORTED_BROWSER_CAPABILITY,
  REASONS.INVALID_JSON,
  'ABI',
  'BASE64',
  'CONTENT',
  'ENCODING',
  'ENVELOPE',
  'FILE',
  'FILES',
  'FILE_BYTES',
  'FILE_HASH',
  'HASH',
  'ID',
  'INVALID_ARGUMENTS',
  'INVALID_TEXT',
  'PATH_COLLISION',
  'PATH_ESCAPE',
  'STDIN_LIMIT',
  'TOTAL_BYTES',
  'UNSAFE_PATH',
  'WORKSPACE_ALIAS',
  'WRITE_VERIFY',
]);

export const NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE = createFactoryExecutionProfile({
  identity: {
    profileId: 'NODE_WEB_PREVIEW_24_V1',
    version: '1.1.0',
    contractVersion: '1.1.0',
  },
  files: {
    pathPolicy: 'ASCII_PORTABLE',
    allowedExtensions: ['.css', '.html', '.js', '.json', '.ts', '.txt', '.xml'],
    forbiddenExtensions: ['.cjs', '.cts', '.jsx', '.mjs', '.mts', '.tsx'],
    requiredFiles: ['index.html'],
    mediaTypes: {
      '.css': 'text/css',
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.json': 'application/json',
      '.ts': 'text/typescript',
      '.txt': 'text/plain',
      '.xml': 'text/xml',
    },
    rule: { ruleId: RULES.FILES, reasonCode: REASONS.UNSUPPORTED_SOURCE_PROFILE },
    requiredFilesRule: {
      ruleId: RULES.REQUIRED_FILES,
      reasonCode: REASONS.INDEX_HTML_REQUIRED,
    },
  },
  sourceDiscovery: {
    extensions: ['.js', '.ts'],
    excludedSuffixes: ['.d.ts'],
    required: true,
    rule: { ruleId: RULES.SOURCE_REQUIRED, reasonCode: REASONS.NO_SUPPORTED_SOURCE },
  },
  testDiscovery: {
    suffixes: ['.test.js', '.test.ts'],
    required: true,
    rule: { ruleId: RULES.TEST_REQUIRED, reasonCode: REASONS.NO_TEST_FILES },
  },
  modulePolicy: {
    format: 'ESM',
    relativeImportExtensions: ['.js'],
    allowedTestBareImports: ['node:assert', 'node:assert/strict', 'node:test'],
    formatRule: { ruleId: RULES.MODULE_FORMAT, reasonCode: REASONS.DEPENDENCY_UNSUPPORTED },
    importRule: { ruleId: RULES.IMPORT_POLICY, reasonCode: REASONS.DEPENDENCY_UNSUPPORTED },
  },
  packagePolicy: {
    path: 'package.json',
    type: 'module',
    dependencies: 'FORBIDDEN',
    scripts: 'FORBIDDEN',
    rule: { ruleId: RULES.PACKAGE_POLICY, reasonCode: REASONS.PACKAGE_POLICY },
    invalidJsonReasonCode: REASONS.PACKAGE_JSON,
  },
  contentRules: {
    html: {
      forbiddenElements: ['base', 'embed', 'form', 'iframe', 'object'],
      forbiddenAttributes: ['style'],
      forbiddenAttributePrefixes: ['on'],
      forbidInlineScript: true,
      forbidStyleElement: true,
      referenceAttributes: ['href', 'src'],
      elementsRule: { ruleId: RULES.HTML_ELEMENTS, reasonCode: REASONS.UNSUPPORTED_HTML },
      inlineActiveRule: {
        ruleId: RULES.HTML_INLINE_ACTIVE,
        reasonCode: REASONS.INLINE_ACTIVE_CONTENT,
      },
      referencesRule: {
        ruleId: RULES.HTML_REFERENCES,
        reasonCode: REASONS.EXTERNAL_OR_UNSAFE_REFERENCE,
      },
    },
    css: {
      forbidImport: true,
      relativeUrlsOnly: true,
      importRule: { ruleId: RULES.CSS_IMPORT, reasonCode: REASONS.UNSUPPORTED_CSS },
      urlsRule: {
        ruleId: RULES.CSS_URLS,
        reasonCode: REASONS.EXTERNAL_OR_UNSAFE_REFERENCE,
      },
    },
    javaScript: {
      forbiddenCapabilities: [
        'EventSource',
        'SharedWorker',
        'WebSocket',
        'Worker',
        'eval',
        'importScripts',
        'navigator.sendBeacon',
        'navigator.serviceWorker',
        'new Function',
      ],
      relativeImportsOnly: true,
      relativeFetchOnly: true,
      capabilitiesRule: {
        ruleId: RULES.JAVASCRIPT_CAPABILITIES,
        reasonCode: REASONS.UNSUPPORTED_BROWSER_CAPABILITY,
      },
      referencesRule: {
        ruleId: RULES.JAVASCRIPT_REFERENCES,
        reasonCode: REASONS.EXTERNAL_OR_UNSAFE_REFERENCE,
      },
    },
    json: {
      parseRequired: true,
      rule: { ruleId: RULES.JSON_VALID, reasonCode: REASONS.INVALID_JSON },
    },
  },
  buildSemantics: {
    runtime: 'NODE',
    runtimeVersion: '24.19.0',
    typeScriptVersion: '6.0.3',
    target: 'ES2022',
    module: 'ES2022',
    strict: true,
    allowJavaScript: true,
    checkJavaScript: true,
    packageManager: 'NONE',
    typeCheck: {
      requiredDiagnosticCount: 0,
      moduleResolution: 'BUNDLER',
      esModuleInterop: true,
      noEmitOnError: true,
      skipLibCheck: false,
      ambientTypePackages: [],
      javaScriptParameterTyping: 'INFERENCE_OR_JSDOC_REQUIRED',
      nullableDomAccess: 'EXPLICIT_NARROWING_REQUIRED',
      testModuleDeclarations: {
        'node:test':
          'type TestBody = () => void | Promise<void>; export function test(name: string, body: TestBody): void; export default test;',
        'node:assert':
          'interface Assert { ok(value: unknown, message?: string): asserts value; equal(actual: unknown, expected: unknown, message?: string): void; deepEqual(actual: unknown, expected: unknown, message?: string): void; strictEqual(actual: unknown, expected: unknown, message?: string): void; throws(body: () => unknown): void; } const assert: Assert; export = assert;',
        'node:assert/strict': "import assert = require('node:assert'); export = assert;",
      },
      unlistedTestApis: 'FORBIDDEN',
    },
  },
  previewProjection: {
    requiredEntrypoint: 'index.html',
    staticExtensions: ['.css', '.html', '.json', '.txt', '.xml'],
    testVisibility: 'TEST',
    applicationVisibility: 'PREVIEW',
  },
  sandbox: { policyId: 'NODE_WEB_PREVIEW_24_V1', policyVersion: '1.1.0' },
  publicReasonCodes: {
    PREPARE: [...PREPARE_REASON_CODES],
    TYPECHECK: [
      'FILE_ALIAS',
      'FILE_BYTES',
      'FILE_HASH',
      'FILE_SET',
      'FILE_TYPE',
      'INVALID_ARGUMENTS',
      'INVALID_TEXT',
      'MANIFEST',
      'MANIFEST_FILE',
      REASONS.NO_SUPPORTED_SOURCE,
      'TYPESCRIPT_DIAGNOSTICS',
      'TYPESCRIPT_VERSION',
      'WORKSPACE_ALIAS',
      'WORKSPACE_SPECIAL_FILE',
      'WORKSPACE_SYMLINK',
    ],
    BUILD: [
      'ARTIFACT_BYTES',
      'BUILD_EMIT',
      'BUILD_FILE_BYTES',
      'BUILD_FILE_HASH',
      'BUILD_FILE_SET',
      'BUILD_MANIFEST',
      'BUILD_MANIFEST_FILE',
      'BUILD_MEDIA_TYPE',
      'BUILD_PATH',
      'BUILD_PATH_COLLISION',
      'BUILD_VISIBILITY',
      REASONS.EXTERNAL_OR_UNSAFE_REFERENCE,
      'FILE_ALIAS',
      'FILE_BYTES',
      'FILE_HASH',
      'FILE_SET',
      'FILE_TYPE',
      REASONS.INDEX_HTML_REQUIRED,
      REASONS.INLINE_ACTIVE_CONTENT,
      'INVALID_ARGUMENTS',
      'INVALID_TEXT',
      'MANIFEST',
      'MANIFEST_FILE',
      REASONS.NO_SUPPORTED_SOURCE,
      'TYPESCRIPT_DIAGNOSTICS',
      'TYPESCRIPT_VERSION',
      REASONS.UNSUPPORTED_BROWSER_CAPABILITY,
      REASONS.UNSUPPORTED_CSS,
      REASONS.UNSUPPORTED_HTML,
      'UNSUPPORTED_PREVIEW_FILE',
      'WORKSPACE_ALIAS',
      'WORKSPACE_SPECIAL_FILE',
      'WORKSPACE_SYMLINK',
      'WRITE_VERIFY',
    ],
    TEST: [
      'BUILD_FILE_BYTES',
      'BUILD_FILE_HASH',
      'BUILD_FILE_SET',
      'BUILD_MANIFEST',
      'BUILD_MANIFEST_FILE',
      'BUILD_MEDIA_TYPE',
      'BUILD_VISIBILITY',
      'FILE_ALIAS',
      'FILE_BYTES',
      'FILE_HASH',
      'FILE_SET',
      'FILE_TYPE',
      'INVALID_ARGUMENTS',
      'INVALID_TEXT',
      'MANIFEST',
      'MANIFEST_FILE',
      REASONS.NO_TEST_FILES,
      'TEST_FAILED',
      'WORKSPACE_ALIAS',
      'WORKSPACE_SPECIAL_FILE',
      'WORKSPACE_SYMLINK',
    ],
  },
});
