import path from 'node:path';

import { KNOWLEDGE_ERROR_CODES, KnowledgeLoaderError } from '../errors';

interface PathValidationContext {
  sourceId: string;
}

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:/;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

function pathError(
  message: string,
  code:
    | typeof KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_AUTHORIZED
    | typeof KNOWLEDGE_ERROR_CODES.PATH_TRAVERSAL,
  context: PathValidationContext,
): KnowledgeLoaderError {
  return new KnowledgeLoaderError(message, {
    code,
    sourceId: context.sourceId,
  });
}

function assertRelativePathSegments(locator: string, context: PathValidationContext): string[] {
  if (locator.length === 0 || locator.trim() !== locator || CONTROL_CHARACTER.test(locator)) {
    throw pathError(
      'O identificador do documento deve ser um caminho relativo seguro.',
      KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_AUTHORIZED,
      context,
    );
  }

  if (
    locator.includes('\\') ||
    path.posix.isAbsolute(locator) ||
    path.win32.isAbsolute(locator) ||
    WINDOWS_DRIVE_PATH.test(locator)
  ) {
    throw pathError(
      'Caminhos absolutos e separadores não POSIX não são permitidos.',
      KNOWLEDGE_ERROR_CODES.PATH_TRAVERSAL,
      context,
    );
  }

  const segments = locator.split('/');

  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw pathError(
        'Segmentos de navegação de diretório não são permitidos.',
        KNOWLEDGE_ERROR_CODES.PATH_TRAVERSAL,
        context,
      );
    }

    if (segment.startsWith('.')) {
      throw pathError(
        'Segmentos ocultos não são permitidos.',
        KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_AUTHORIZED,
        context,
      );
    }
  }

  return segments;
}

export function assertSafeKnowledgeLocator(locator: string, context: PathValidationContext): void {
  const segments = assertRelativePathSegments(locator, context);
  const filename = segments.at(-1);

  if (filename === undefined || path.posix.extname(filename) !== '.md') {
    throw pathError(
      'Somente documentos Markdown com extensão .md são permitidos.',
      KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_AUTHORIZED,
      context,
    );
  }
}

export function assertSafeKnowledgeDirectory(
  locator: string,
  context: PathValidationContext,
): void {
  assertRelativePathSegments(locator, context);
}

export function resolveContainedPath(
  rootRealPath: string,
  locator: string,
  context: PathValidationContext,
): string {
  const candidatePath = path.resolve(rootRealPath, ...locator.split('/'));
  assertPathContained(rootRealPath, candidatePath, context);
  return candidatePath;
}

export function assertPathContained(
  rootRealPath: string,
  candidateRealPath: string,
  context: PathValidationContext,
): void {
  const relativePath = path.relative(rootRealPath, candidateRealPath);

  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw pathError(
      'O documento solicitado está fora da origem autorizada.',
      KNOWLEDGE_ERROR_CODES.PATH_TRAVERSAL,
      context,
    );
  }
}
