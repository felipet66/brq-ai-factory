import { Buffer } from 'node:buffer';
import { extname } from 'node:path';

import { deepFreeze } from './immutability';
import { CODE_GENERATOR_CONTRACT_LIMITS } from './limits';

export const CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES = {
  INVALID_OUTPUT_STRUCTURE: 'CODE_GENERATOR_INVALID_OUTPUT_STRUCTURE',
  EMPTY_BUNDLE: 'CODE_GENERATOR_EMPTY_BUNDLE',
  TOO_MANY_FILES: 'CODE_GENERATOR_TOO_MANY_FILES',
  EMPTY_FILE_CONTENT: 'CODE_GENERATOR_EMPTY_FILE_CONTENT',
  FILE_TOO_LARGE: 'CODE_GENERATOR_FILE_TOO_LARGE',
  BUNDLE_TOO_LARGE: 'CODE_GENERATOR_BUNDLE_TOO_LARGE',
  UNSAFE_PATH: 'CODE_GENERATOR_UNSAFE_PATH',
  PATH_LIMIT_EXCEEDED: 'CODE_GENERATOR_PATH_LIMIT_EXCEEDED',
  SENSITIVE_PATH: 'CODE_GENERATOR_SENSITIVE_PATH',
  DUPLICATE_PATH: 'CODE_GENERATOR_DUPLICATE_PATH',
  AMBIGUOUS_PATH_COLLISION: 'CODE_GENERATOR_AMBIGUOUS_PATH_COLLISION',
  FILE_DIRECTORY_CONFLICT: 'CODE_GENERATOR_FILE_DIRECTORY_CONFLICT',
  UNSUPPORTED_FILE_TYPE: 'CODE_GENERATOR_UNSUPPORTED_FILE_TYPE',
  MEDIA_TYPE_MISMATCH: 'CODE_GENERATOR_MEDIA_TYPE_MISMATCH',
  INVALID_TEXT_CONTENT: 'CODE_GENERATOR_INVALID_TEXT_CONTENT',
  SENSITIVE_CONTENT: 'CODE_GENERATOR_SENSITIVE_CONTENT',
  MISSING_SOURCE_REFERENCE: 'CODE_GENERATOR_MISSING_SOURCE_REFERENCE',
  DUPLICATE_SOURCE_REFERENCE: 'CODE_GENERATOR_DUPLICATE_SOURCE_REFERENCE',
  UNKNOWN_MODULE_REFERENCE: 'CODE_GENERATOR_UNKNOWN_MODULE_REFERENCE',
  UNKNOWN_PLAN_REFERENCE: 'CODE_GENERATOR_UNKNOWN_PLAN_REFERENCE',
  MODULE_PATH_MISMATCH: 'CODE_GENERATOR_MODULE_PATH_MISMATCH',
  MISSING_MODULE_COVERAGE: 'CODE_GENERATOR_MISSING_MODULE_COVERAGE',
  TOO_MANY_ENTRYPOINTS: 'CODE_GENERATOR_TOO_MANY_ENTRYPOINTS',
  MISSING_ENTRYPOINT: 'CODE_GENERATOR_MISSING_ENTRYPOINT',
  DUPLICATE_ENTRYPOINT: 'CODE_GENERATOR_DUPLICATE_ENTRYPOINT',
  UNKNOWN_ENTRYPOINT: 'CODE_GENERATOR_UNKNOWN_ENTRYPOINT',
} as const;

export const CODE_GENERATOR_BUSINESS_VALIDATION_MAX_ISSUES = 100;

export type CodeGeneratorBusinessValidationIssueCode =
  (typeof CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES)[keyof typeof CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES];

export interface CodeGeneratorBusinessValidationIssue {
  readonly code: CodeGeneratorBusinessValidationIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export interface CodeGeneratorBusinessValidationResult {
  readonly valid: boolean;
  readonly issues: readonly CodeGeneratorBusinessValidationIssue[];
  readonly issuesTruncated: boolean;
}

export interface CodeGeneratorTechnicalSpecificationInput {
  readonly modules: readonly {
    readonly id: string;
    readonly path: string;
    readonly changeType: 'CREATE' | 'MODIFY' | 'DELETE';
  }[];
  readonly implementationPlan: readonly { readonly id: string }[];
}

export interface CodeGenerationProposalInput {
  readonly files: readonly {
    readonly path: string;
    readonly content: string;
    readonly encoding: string;
    readonly mediaType: string;
    readonly purpose: string;
    readonly sourceModuleIds: readonly string[];
    readonly sourcePlanItemIds: readonly string[];
  }[];
  readonly entrypoints: readonly string[];
}

interface StructureIssue {
  readonly path: readonly PropertyKey[];
}

const { generation } = CODE_GENERATOR_CONTRACT_LIMITS;
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const PORTABLE_SEGMENT = /^[\p{L}\p{N}_@+.,()\[\]{}-]+$/u;
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const SENSITIVE_SEGMENT =
  /^(?:\.env(?:\..*)?|\.git|\.ssh|\.npmrc|\.pypirc|node_modules|git-credentials(?:\..*)?|authorized_keys(?:\..*)?|known_hosts(?:\..*)?|private[-_]?key(?:\..*)?|(?:credentials?|secrets?)(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?)$/i;
const SENSITIVE_CONTENT =
  /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\b(?:password|passwd|secret|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*['"][^'"\r\n]{8,}['"]/i;

const MEDIA_TYPES_BY_EXTENSION: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  '.cjs': new Set(['text/javascript']),
  '.css': new Set(['text/css']),
  '.html': new Set(['text/html']),
  '.js': new Set(['text/javascript']),
  '.json': new Set(['application/json']),
  '.jsx': new Set(['text/javascript']),
  '.md': new Set(['text/markdown']),
  '.mjs': new Set(['text/javascript']),
  '.prisma': new Set(['text/x-prisma']),
  '.sql': new Set(['application/sql']),
  '.ts': new Set(['text/typescript']),
  '.tsx': new Set(['text/typescript']),
  '.txt': new Set(['text/plain']),
  '.xml': new Set(['text/xml']),
  '.yaml': new Set(['application/yaml']),
  '.yml': new Set(['application/yaml']),
});

function sanitizedPath(path: readonly PropertyKey[]): readonly (string | number)[] {
  const result: (string | number)[] = [];
  for (const segment of path.slice(0, 32)) {
    if (typeof segment === 'string') result.push(segment);
    if (typeof segment === 'number' && Number.isInteger(segment) && segment >= 0) {
      result.push(segment);
    }
  }
  return result;
}

export function createCodeGeneratorBusinessStructureRejection(
  structureIssues: readonly StructureIssue[],
): CodeGeneratorBusinessValidationResult {
  const sourceIssues =
    structureIssues.length === 0
      ? [{ path: [] }]
      : structureIssues.slice(0, CODE_GENERATOR_BUSINESS_VALIDATION_MAX_ISSUES);
  return deepFreeze({
    valid: false,
    issues: sourceIssues.map(({ path }) => ({
      code: CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.INVALID_OUTPUT_STRUCTURE,
      path: sanitizedPath(path),
      message: 'A proposta não atende à estrutura de geração de código esperada.',
    })),
    issuesTruncated: structureIssues.length > sourceIssues.length,
  });
}

function addIssue(
  issues: CodeGeneratorBusinessValidationIssue[],
  code: CodeGeneratorBusinessValidationIssueCode,
  path: readonly (string | number)[],
  message: string,
): void {
  if (issues.length <= CODE_GENERATOR_BUSINESS_VALIDATION_MAX_ISSUES) {
    issues.push({ code, path, message });
  }
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (!(following >= 0xdc00 && following <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export interface CodeGeneratorPathInspection {
  readonly reason: 'UNSAFE' | 'SENSITIVE' | null;
  readonly limitExceeded: boolean;
  readonly portableKey: string;
}

export function inspectCodeGeneratorPath(path: string): CodeGeneratorPathInspection {
  const segments = path.split('/');
  const limitExceeded =
    Buffer.byteLength(path, 'utf8') > generation.pathBytes ||
    segments.length > generation.pathSegments ||
    segments.some((segment) => Buffer.byteLength(segment, 'utf8') > generation.segmentBytes);
  const portableKey = path.normalize('NFKC').toLocaleLowerCase('en-US');
  if (segments.some((segment) => SENSITIVE_SEGMENT.test(segment))) {
    return { reason: 'SENSITIVE', limitExceeded, portableKey };
  }
  const unsafe =
    path !== path.trim() ||
    path !== path.normalize('NFC') ||
    path.startsWith('/') ||
    WINDOWS_DRIVE_PATH.test(path) ||
    path.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        segment.startsWith('.') ||
        segment.endsWith('.') ||
        segment.endsWith(' ') ||
        !PORTABLE_SEGMENT.test(segment) ||
        WINDOWS_RESERVED_NAME.test(segment),
    );
  return { reason: unsafe ? 'UNSAFE' : null, limitExceeded, portableKey };
}

function validateDuplicateReferences(
  issues: CodeGeneratorBusinessValidationIssue[],
  references: readonly string[],
  path: readonly (string | number)[],
): void {
  const seen = new Set<string>();
  references.forEach((reference, index) => {
    if (seen.has(reference)) {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_SOURCE_REFERENCE,
        [...path, index],
        'Uma referência técnica não pode ser repetida no mesmo arquivo.',
      );
    }
    seen.add(reference);
  });
}

function validateKnownReferences(
  issues: CodeGeneratorBusinessValidationIssue[],
  references: readonly string[],
  knownIds: ReadonlySet<string>,
  path: readonly (string | number)[],
  unknownCode: CodeGeneratorBusinessValidationIssueCode,
): void {
  references.forEach((reference, index) => {
    if (!knownIds.has(reference)) {
      addIssue(
        issues,
        unknownCode,
        [...path, index],
        'A referência técnica deve existir na fonte.',
      );
    }
  });
}

function finalizeIssues(
  issues: readonly CodeGeneratorBusinessValidationIssue[],
): CodeGeneratorBusinessValidationResult {
  const issuesTruncated = issues.length > CODE_GENERATOR_BUSINESS_VALIDATION_MAX_ISSUES;
  const publicIssues = issues.slice(0, CODE_GENERATOR_BUSINESS_VALIDATION_MAX_ISSUES);
  return deepFreeze({
    valid: publicIssues.length === 0,
    issues: publicIssues,
    issuesTruncated,
  });
}

function collectCodeGenerationOutputSafetyIssues(
  proposal: CodeGenerationProposalInput,
): CodeGeneratorBusinessValidationIssue[] {
  const issues: CodeGeneratorBusinessValidationIssue[] = [];
  const exactPaths = new Set<string>();
  const portablePaths = new Set<string>();
  let totalBytes = 0;

  if (proposal.files.length === 0) {
    addIssue(
      issues,
      CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.EMPTY_BUNDLE,
      ['files'],
      'A proposta deve conter ao menos um arquivo textual.',
    );
  }
  if (proposal.files.length > generation.files) {
    addIssue(
      issues,
      CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.TOO_MANY_FILES,
      ['files'],
      `A proposta excede o limite de ${generation.files} arquivos.`,
    );
  }

  proposal.files.forEach((file, index) => {
    const filePath = ['files', index] as const;
    const pathInspection = inspectCodeGeneratorPath(file.path);
    if (pathInspection.limitExceeded) {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.PATH_LIMIT_EXCEEDED,
        [...filePath, 'path'],
        'O path excede o limite de bytes, segmentos ou bytes por segmento.',
      );
    }
    if (pathInspection.reason === 'UNSAFE') {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.UNSAFE_PATH,
        [...filePath, 'path'],
        'O path deve ser relativo, POSIX, NFC e não ambíguo.',
      );
    } else if (pathInspection.reason === 'SENSITIVE') {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.SENSITIVE_PATH,
        [...filePath, 'path'],
        'O path referencia um arquivo ou diretório sensível.',
      );
    }

    if (exactPaths.has(file.path)) {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_PATH,
        [...filePath, 'path'],
        'O path não pode ser repetido.',
      );
    }
    const portableKey = pathInspection.portableKey;
    if (!exactPaths.has(file.path) && portablePaths.has(portableKey)) {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.AMBIGUOUS_PATH_COLLISION,
        [...filePath, 'path'],
        'O path colide por caixa ou normalização Unicode.',
      );
    }
    if (
      [...portablePaths].some(
        (existingPath) =>
          portableKey.startsWith(`${existingPath}/`) || existingPath.startsWith(`${portableKey}/`),
      )
    ) {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.FILE_DIRECTORY_CONFLICT,
        [...filePath, 'path'],
        'Um mesmo path lógico não pode ser arquivo e diretório.',
      );
    }
    exactPaths.add(file.path);
    portablePaths.add(portableKey);

    const extension = extname(file.path).toLowerCase();
    const supportedMediaTypes = MEDIA_TYPES_BY_EXTENSION[extension];
    if (supportedMediaTypes === undefined) {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.UNSUPPORTED_FILE_TYPE,
        [...filePath, 'path'],
        'A extensão do arquivo não pertence à allowlist textual.',
      );
    } else if (!supportedMediaTypes.has(file.mediaType)) {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.MEDIA_TYPE_MISMATCH,
        [...filePath, 'mediaType'],
        'O media type não corresponde à extensão do arquivo.',
      );
    }

    const byteLength = Buffer.byteLength(file.content, 'utf8');
    totalBytes += byteLength;
    if (byteLength === 0) {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.EMPTY_FILE_CONTENT,
        [...filePath, 'content'],
        'Todo arquivo materializável deve possuir conteúdo textual não vazio.',
      );
    }
    if (byteLength > generation.fileBytes) {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.FILE_TOO_LARGE,
        [...filePath, 'content'],
        `O arquivo excede ${generation.fileBytes} bytes.`,
      );
    }
    if (!isWellFormedUnicode(file.content) || DISALLOWED_CONTROL.test(file.content)) {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.INVALID_TEXT_CONTENT,
        [...filePath, 'content'],
        'O conteúdo deve ser texto Unicode bem formado e sem bytes de controle proibidos.',
      );
    }
    if (SENSITIVE_CONTENT.test(file.content)) {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.SENSITIVE_CONTENT,
        [...filePath, 'content'],
        'O conteúdo não pode incorporar credenciais ou material de chave privada.',
      );
    }

    if (file.sourceModuleIds.length === 0 && file.sourcePlanItemIds.length === 0) {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_SOURCE_REFERENCE,
        [...filePath, 'sourceModuleIds'],
        'Cada arquivo deve referenciar ao menos um módulo ou item do plano técnico.',
      );
    }
    validateDuplicateReferences(issues, file.sourceModuleIds, [...filePath, 'sourceModuleIds']);
    validateDuplicateReferences(issues, file.sourcePlanItemIds, [...filePath, 'sourcePlanItemIds']);
  });

  if (totalBytes > generation.bundleBytes) {
    addIssue(
      issues,
      CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.BUNDLE_TOO_LARGE,
      ['files'],
      `O conteúdo total excede ${generation.bundleBytes} bytes.`,
    );
  }

  if (proposal.entrypoints.length > generation.entrypoints) {
    addIssue(
      issues,
      CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.TOO_MANY_ENTRYPOINTS,
      ['entrypoints'],
      `A proposta excede ${generation.entrypoints} entrypoints.`,
    );
  }
  if (proposal.entrypoints.length === 0) {
    addIssue(
      issues,
      CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_ENTRYPOINT,
      ['entrypoints'],
      'O perfil inicial exige ao menos um entrypoint materializável.',
    );
  }
  const seenEntrypoints = new Set<string>();
  proposal.entrypoints.forEach((entrypoint, index) => {
    if (seenEntrypoints.has(entrypoint)) {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_ENTRYPOINT,
        ['entrypoints', index],
        'Um entrypoint não pode ser repetido.',
      );
    }
    if (!exactPaths.has(entrypoint)) {
      addIssue(
        issues,
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_ENTRYPOINT,
        ['entrypoints', index],
        'Todo entrypoint deve referenciar um arquivo presente no bundle.',
      );
    }
    seenEntrypoints.add(entrypoint);
  });

  return issues;
}

export function validateCodeGenerationOutputSafety(
  proposal: CodeGenerationProposalInput,
): CodeGeneratorBusinessValidationResult {
  return finalizeIssues(collectCodeGenerationOutputSafetyIssues(proposal));
}

export function validateCodeGenerationBusinessRules(
  proposal: CodeGenerationProposalInput,
  technicalSpecification: CodeGeneratorTechnicalSpecificationInput,
): CodeGeneratorBusinessValidationResult {
  const issues = collectCodeGenerationOutputSafetyIssues(proposal);
  const modulesById = new Map(technicalSpecification.modules.map((module) => [module.id, module]));
  const moduleIds = new Set(modulesById.keys());
  const planIds = new Set(technicalSpecification.implementationPlan.map((item) => item.id));
  const coveredModuleIds = new Set<string>();

  proposal.files.forEach((file, index) => {
    const filePath = ['files', index] as const;
    validateKnownReferences(
      issues,
      file.sourceModuleIds,
      moduleIds,
      [...filePath, 'sourceModuleIds'],
      CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_MODULE_REFERENCE,
    );
    validateKnownReferences(
      issues,
      file.sourcePlanItemIds,
      planIds,
      [...filePath, 'sourcePlanItemIds'],
      CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_PLAN_REFERENCE,
    );
    file.sourceModuleIds.forEach((moduleId, referenceIndex) => {
      const technicalModule = modulesById.get(moduleId);
      if (technicalModule === undefined) return;
      coveredModuleIds.add(moduleId);
      if (file.path !== technicalModule.path && !file.path.startsWith(`${technicalModule.path}/`)) {
        addIssue(
          issues,
          CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.MODULE_PATH_MISMATCH,
          [...filePath, 'sourceModuleIds', referenceIndex],
          'Um arquivo referenciado por módulo deve permanecer dentro do path desse módulo.',
        );
      }
    });
  });

  technicalSpecification.modules
    .filter((module) => module.changeType === 'CREATE')
    .forEach((module, index) => {
      if (!coveredModuleIds.has(module.id)) {
        addIssue(
          issues,
          CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_MODULE_COVERAGE,
          ['technicalSpecification', 'modules', index, 'id'],
          'Todo módulo CREATE deve possuir ao menos um arquivo rastreado.',
        );
      }
    });

  return finalizeIssues(issues);
}
