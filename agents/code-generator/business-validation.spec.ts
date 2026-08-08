import { describe, expect, it } from 'vitest';

import {
  CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES as CODES,
  validateCodeGenerationBusinessRules,
  type CodeGenerationProposalInput,
} from './business-validation';
import { CODE_GENERATOR_CONTRACT_LIMITS } from './limits';
import {
  createCodeGeneratorTechnicalSpecification,
  createGeneratedCodeProposal,
} from './testing/code-generator-fixtures';

function validate(proposal: CodeGenerationProposalInput) {
  return validateCodeGenerationBusinessRules(proposal, createCodeGeneratorTechnicalSpecification());
}

function issueCodes(proposal: CodeGenerationProposalInput): readonly string[] {
  return validate(proposal).issues.map((issue) => issue.code);
}

function withFiles(
  files: CodeGenerationProposalInput['files'],
  entrypoints: readonly string[] = [files[0]?.path ?? 'missing.ts'],
): CodeGenerationProposalInput {
  return { files, entrypoints };
}

describe('Code Generator Business Validation', () => {
  it('accepts a non-empty, traced textual bundle with a real entrypoint', () => {
    const result = validate(createGeneratedCodeProposal());

    expect(result).toEqual({ valid: true, issues: [], issuesTruncated: false });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.issues)).toBe(true);
  });

  it('rejects an empty bundle and the absence of an entrypoint', () => {
    const result = validate({ files: [], entrypoints: [] });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        CODES.EMPTY_BUNDLE,
        CODES.MISSING_MODULE_COVERAGE,
        CODES.MISSING_ENTRYPOINT,
      ]),
    );
  });

  it.each([
    '/absolute/index.ts',
    '../escape.ts',
    'core/order-query/../escape.ts',
    'C:/escape.ts',
    'core\\order-query\\index.ts',
    'core/order-query//index.ts',
    'core/order-query/.hidden.ts',
    'core/order query/index.ts',
    'core/order-query/index\u0000.ts',
    'core/order-query/cafe\u0301.ts',
  ])('rejects unsafe path %s', (path) => {
    const base = createGeneratedCodeProposal().files[0]!;
    expect(issueCodes(withFiles([{ ...base, path }]))).toContain(CODES.UNSAFE_PATH);
  });

  it.each([
    'core/order-query/.env',
    'core/order-query/.git/config.json',
    'core/order-query/id_rsa.txt',
    'core/order-query/credentials.json',
    'core/order-query/git-credentials.backup',
    'core/order-query/authorized_keys',
    'core/order-query/authorized_keys.backup',
    'core/order-query/known_hosts',
    'core/order-query/known_hosts.old',
    'core/order-query/node_modules/index.ts',
    'core/order-query/private-key',
    'core/order-query/private_key',
  ])('rejects sensitive path %s', (path) => {
    const base = createGeneratedCodeProposal().files[0]!;
    expect(issueCodes(withFiles([{ ...base, path }]))).toContain(CODES.SENSITIVE_PATH);
  });

  it('rejects exact, case-insensitive and Unicode-compatible path collisions', () => {
    const base = createGeneratedCodeProposal().files[0]!;
    const paths = [
      'core/order-query/a.ts',
      'core/order-query/a.ts',
      'core/order-query/B.ts',
      'core/order-query/b.ts',
      'core/order-query/café.ts',
      'core/order-query/cafe\u0301.ts',
    ];
    const codes = issueCodes(
      withFiles(
        paths.map((path) => ({ ...base, path })),
        [paths[0]!],
      ),
    );

    expect(codes).toContain(CODES.DUPLICATE_PATH);
    expect(codes).toContain(CODES.AMBIGUOUS_PATH_COLLISION);
  });

  it('detects portable file-versus-directory conflicts, including ancestor case changes', () => {
    const base = createGeneratedCodeProposal().files[0]!;
    const codes = issueCodes(
      withFiles(
        [
          { ...base, path: 'core/order-query/Src.ts' },
          { ...base, path: 'core/order-query/src.ts/index.ts' },
        ],
        ['core/order-query/Src.ts'],
      ),
    );

    expect(codes).toContain(CODES.FILE_DIRECTORY_CONFLICT);
  });

  it('enforces path byte, depth and segment byte ceilings', () => {
    const base = createGeneratedCodeProposal().files[0]!;
    const deep = `${Array.from({ length: 21 }, (_, index) => `s${index}`).join('/')}.ts`;
    const longSegment = `core/order-query/${'á'.repeat(128)}.ts`;
    const overPathBytes = `core/order-query/${'界'.repeat(170)}.ts`;

    for (const path of [deep, longSegment, overPathBytes]) {
      expect(issueCodes(withFiles([{ ...base, path }]))).toContain(CODES.PATH_LIMIT_EXCEEDED);
    }
  });

  it('rejects unsupported extensions and media types inconsistent with extension', () => {
    const base = createGeneratedCodeProposal().files[0]!;
    expect(issueCodes(withFiles([{ ...base, path: 'core/order-query/image.png' }]))).toContain(
      CODES.UNSUPPORTED_FILE_TYPE,
    );
    expect(
      issueCodes(
        withFiles([{ ...base, path: 'core/order-query/index.ts', mediaType: 'text/plain' }]),
      ),
    ).toContain(CODES.MEDIA_TYPE_MISMATCH);
  });

  it('accepts the aligned SQL, Prisma and YAML media types', () => {
    const base = createGeneratedCodeProposal().files[0]!;
    const files = [
      { ...base, path: 'core/order-query/schema.prisma', mediaType: 'text/x-prisma' },
      { ...base, path: 'core/order-query/query.sql', mediaType: 'application/sql' },
      { ...base, path: 'core/order-query/config.yaml', mediaType: 'application/yaml' },
    ];

    expect(validate(withFiles(files, [files[0]!.path])).valid).toBe(true);
  });

  it('enforces exact per-file and aggregate UTF-8 byte limits', () => {
    const base = createGeneratedCodeProposal().files[0]!;
    const tooLarge = '界'.repeat(
      Math.floor(CODE_GENERATOR_CONTRACT_LIMITS.generation.fileBytes / 3) + 1,
    );
    expect(issueCodes(withFiles([{ ...base, content: tooLarge }]))).toContain(CODES.FILE_TOO_LARGE);

    const content = 'a'.repeat(CODE_GENERATOR_CONTRACT_LIMITS.generation.fileBytes);
    const files = Array.from({ length: 7 }, (_, index) => ({
      ...base,
      path: `core/order-query/file-${index}.ts`,
      content,
    }));
    expect(issueCodes(withFiles(files, [files[0]!.path]))).toContain(CODES.BUNDLE_TOO_LARGE);
  });

  it('rejects an empty generated file before bundle assembly', () => {
    const base = createGeneratedCodeProposal().files[0]!;

    expect(issueCodes(withFiles([{ ...base, content: '' }]))).toContain(CODES.EMPTY_FILE_CONTENT);
  });

  it('rejects malformed Unicode, control bytes and embedded secret material', () => {
    const base = createGeneratedCodeProposal().files[0]!;
    expect(issueCodes(withFiles([{ ...base, content: '\ud800' }]))).toContain(
      CODES.INVALID_TEXT_CONTENT,
    );
    expect(issueCodes(withFiles([{ ...base, content: 'const value = "x";\u0000' }]))).toContain(
      CODES.INVALID_TEXT_CONTENT,
    );
    for (const content of [
      'api_key = "secret-that-must-not-leak";',
      'const aws = "AKIA1234567890ABCDEF";',
      'const github = "ghp_1234567890abcdefghij";',
      'const openai = "sk-proj-1234567890abcdefghij";',
      'const jwt = "eyJabcdefghij.abcdefghij.abcdefghij";',
      '-----BEGIN PRIVATE KEY-----',
      '-----BEGIN DSA PRIVATE KEY-----',
    ]) {
      expect(issueCodes(withFiles([{ ...base, content }]))).toContain(CODES.SENSITIVE_CONTENT);
    }
  });

  it('requires known, unique module and plan references on every file', () => {
    const base = createGeneratedCodeProposal().files[0]!;
    const missing = issueCodes(
      withFiles([{ ...base, sourceModuleIds: [], sourcePlanItemIds: [] }]),
    );
    expect(missing).toContain(CODES.MISSING_SOURCE_REFERENCE);

    const invalid = issueCodes(
      withFiles([
        {
          ...base,
          sourceModuleIds: ['MOD-001', 'MOD-001', 'MOD-999'],
          sourcePlanItemIds: ['PLAN-001', 'PLAN-001', 'PLAN-999'],
        },
      ]),
    );
    expect(invalid).toContain(CODES.DUPLICATE_SOURCE_REFERENCE);
    expect(invalid).toContain(CODES.UNKNOWN_MODULE_REFERENCE);
    expect(invalid).toContain(CODES.UNKNOWN_PLAN_REFERENCE);
  });

  it('requires module paths and complete coverage of every CREATE module', () => {
    const base = createGeneratedCodeProposal().files[0]!;
    expect(issueCodes(withFiles([{ ...base, path: 'outside/index.ts' }]))).toContain(
      CODES.MODULE_PATH_MISMATCH,
    );

    const specification = createCodeGeneratorTechnicalSpecification({
      modules: [
        ...createCodeGeneratorTechnicalSpecification().modules,
        {
          id: 'MOD-002',
          name: 'Second module',
          path: 'core/second-module',
          changeType: 'CREATE',
          responsibility: 'Provide another isolated capability.',
          componentId: 'CMP-001',
          dependsOnModuleIds: [],
        },
      ],
    });
    const result = validateCodeGenerationBusinessRules(
      createGeneratedCodeProposal(),
      specification,
    );
    expect(result.issues.map((issue) => issue.code)).toContain(CODES.MISSING_MODULE_COVERAGE);
  });

  it('requires entrypoints to be unique and point to generated files', () => {
    const proposal = createGeneratedCodeProposal();
    expect(issueCodes({ ...proposal, entrypoints: [] })).toContain(CODES.MISSING_ENTRYPOINT);
    expect(
      issueCodes({
        ...proposal,
        entrypoints: [proposal.entrypoints[0]!, proposal.entrypoints[0]!],
      }),
    ).toContain(CODES.DUPLICATE_ENTRYPOINT);
    expect(issueCodes({ ...proposal, entrypoints: ['core/order-query/missing.ts'] })).toContain(
      CODES.UNKNOWN_ENTRYPOINT,
    );
  });

  it('truncates issues deterministically at the public ceiling', () => {
    const base = createGeneratedCodeProposal().files[0]!;
    const files = Array.from({ length: 96 }, (_, index) => ({
      ...base,
      path: `../unsafe-${index}.exe`,
      sourceModuleIds: ['MOD-999'],
      sourcePlanItemIds: ['PLAN-999'],
    }));
    const result = validate(withFiles(files, [files[0]!.path]));

    expect(result.issues).toHaveLength(100);
    expect(result.issuesTruncated).toBe(true);
  });
});
