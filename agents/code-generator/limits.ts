export const CODE_GENERATOR_CONTRACT_LIMITS = Object.freeze({
  request: Object.freeze({
    technicalSpecificationBytes: 224 * 1024,
    knowledgeBytes: 48 * 1024,
    knowledgeDocuments: 4,
    promptBytes: 384 * 1024,
    maxOutputTokens: 131_072,
    modelCharacters: 200,
    timeoutMs: 600_000,
  }),
  generation: Object.freeze({
    files: 96,
    fileBytes: 64 * 1024,
    bundleBytes: 384 * 1024,
    entrypoints: 16,
    pathCharacters: 512,
    pathBytes: 512,
    pathSegments: 20,
    segmentBytes: 255,
    referencesPerFile: 80,
  }),
});

export const CODE_GENERATOR_CONTRACT_VERSION = '1.0.0' as const;
export const CODE_GENERATOR_BUNDLE_VERSION = '1.0.0' as const;

export const CODE_GENERATOR_MEDIA_TYPES = [
  'application/json',
  'application/sql',
  'application/yaml',
  'text/css',
  'text/html',
  'text/javascript',
  'text/markdown',
  'text/plain',
  'text/x-prisma',
  'text/typescript',
  'text/xml',
] as const;

export const CODE_GENERATOR_FILE_PURPOSES = [
  'SOURCE',
  'TEST',
  'CONFIGURATION',
  'DOCUMENTATION',
  'STYLE',
  'SCHEMA',
] as const;
