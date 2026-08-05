import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import path from 'node:path';

import type { KnowledgeSourceEntry } from '../contracts';
import { KNOWLEDGE_ERROR_CODES, KnowledgeLoaderError } from '../errors';
import type { KnowledgeSource } from '../knowledge-source';
import { knowledgeSourceIdSchema } from '../schemas';
import {
  assertPathContained,
  assertSafeKnowledgeDirectory,
  assertSafeKnowledgeLocator,
  resolveContainedPath,
} from './path-safety';

export const DEFAULT_MAX_DOCUMENT_BYTES = 256 * 1024;

export interface FilesystemKnowledgeSourceOptions {
  sourceId: string;
  rootPath: string;
  allowedLocators: readonly string[];
  maxDocumentBytes?: number;
}

type KnowledgeFilesystemErrorCode =
  | typeof KNOWLEDGE_ERROR_CODES.INVALID_ROOT
  | typeof KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_FOUND
  | typeof KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_AUTHORIZED
  | typeof KNOWLEDGE_ERROR_CODES.SYMLINK_NOT_ALLOWED
  | typeof KNOWLEDGE_ERROR_CODES.READ_FAILED
  | typeof KNOWLEDGE_ERROR_CODES.INVALID_DOCUMENT;

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function filesystemErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const { code } = error as { code?: unknown };
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : undefined;
}

export class FilesystemKnowledgeSource implements KnowledgeSource {
  readonly sourceId: string;

  readonly #rootPath: string;
  readonly #allowedLocators: ReadonlySet<string>;
  readonly #maxDocumentBytes: number;

  constructor(options: FilesystemKnowledgeSourceOptions) {
    if (!knowledgeSourceIdSchema.safeParse(options.sourceId).success) {
      throw new KnowledgeLoaderError('O identificador da origem é inválido.', {
        code: KNOWLEDGE_ERROR_CODES.INVALID_ROOT,
        sourceId: 'filesystem',
      });
    }

    this.sourceId = options.sourceId;

    if (
      options.rootPath.length === 0 ||
      options.rootPath.includes('\0') ||
      !path.isAbsolute(options.rootPath)
    ) {
      throw this.#error(
        'A raiz da origem deve ser um caminho absoluto válido.',
        KNOWLEDGE_ERROR_CODES.INVALID_ROOT,
      );
    }

    const maxDocumentBytes = options.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;

    if (!Number.isSafeInteger(maxDocumentBytes) || maxDocumentBytes <= 0) {
      throw this.#error(
        'O limite de tamanho por documento deve ser um inteiro positivo.',
        KNOWLEDGE_ERROR_CODES.INVALID_ROOT,
      );
    }

    for (const locator of options.allowedLocators) {
      assertSafeKnowledgeLocator(locator, { sourceId: this.sourceId });
    }

    this.#rootPath = options.rootPath;
    this.#allowedLocators = new Set(options.allowedLocators);
    this.#maxDocumentBytes = maxDocumentBytes;
  }

  async discover(): Promise<readonly KnowledgeSourceEntry[]> {
    const rootRealPath = await this.#resolveRoot();
    const entries: KnowledgeSourceEntry[] = [];

    await this.#discoverDirectory(rootRealPath, rootRealPath, '', entries);
    entries.sort((left, right) => compareText(left.locator, right.locator));

    return entries;
  }

  async read(locator: string): Promise<Uint8Array> {
    assertSafeKnowledgeLocator(locator, { sourceId: this.sourceId });

    if (!this.#allowedLocators.has(locator)) {
      throw this.#error(
        'O documento solicitado não está autorizado para leitura.',
        KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_AUTHORIZED,
      );
    }

    const rootRealPath = await this.#resolveRoot();
    const filePath = await this.#resolveRegularFile(rootRealPath, locator);

    try {
      const bytes = await readFile(filePath);

      if (bytes.byteLength > this.#maxDocumentBytes) {
        throw this.#error(
          'O documento excede o limite de tamanho configurado.',
          KNOWLEDGE_ERROR_CODES.INVALID_DOCUMENT,
        );
      }

      return Uint8Array.from(bytes);
    } catch (error) {
      if (error instanceof KnowledgeLoaderError) {
        throw error;
      }

      if (filesystemErrorCode(error) === 'ENOENT') {
        throw this.#error(
          'O documento solicitado não foi encontrado.',
          KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_FOUND,
          error,
        );
      }

      throw this.#error(
        'Não foi possível ler o documento solicitado.',
        KNOWLEDGE_ERROR_CODES.READ_FAILED,
        error,
      );
    }
  }

  async #resolveRoot(): Promise<string> {
    try {
      const rootStats = await lstat(this.#rootPath);

      if (rootStats.isSymbolicLink()) {
        throw this.#error(
          'Links simbólicos não são permitidos na origem de conhecimento.',
          KNOWLEDGE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
        );
      }

      if (!rootStats.isDirectory()) {
        throw this.#error(
          'A raiz da origem deve apontar para um diretório.',
          KNOWLEDGE_ERROR_CODES.INVALID_ROOT,
        );
      }

      return await realpath(this.#rootPath);
    } catch (error) {
      if (error instanceof KnowledgeLoaderError) {
        throw error;
      }

      throw this.#error(
        'A raiz da origem não existe ou não pode ser acessada.',
        KNOWLEDGE_ERROR_CODES.INVALID_ROOT,
        error,
      );
    }
  }

  async #discoverDirectory(
    rootRealPath: string,
    directoryPath: string,
    directoryLocator: string,
    discovered: KnowledgeSourceEntry[],
  ): Promise<void> {
    let entries: Dirent[];

    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      throw this.#error(
        'Não foi possível descobrir os documentos da origem.',
        KNOWLEDGE_ERROR_CODES.READ_FAILED,
        error,
      );
    }

    entries.sort((left, right) => compareText(left.name, right.name));

    for (const entry of entries) {
      const locator = directoryLocator ? path.posix.join(directoryLocator, entry.name) : entry.name;
      const entryPath = path.join(directoryPath, entry.name);
      let entryStats: Stats;

      try {
        entryStats = await lstat(entryPath);
      } catch (error) {
        throw this.#error(
          'Não foi possível inspecionar um item da origem.',
          KNOWLEDGE_ERROR_CODES.READ_FAILED,
          error,
        );
      }

      if (entryStats.isSymbolicLink()) {
        throw this.#error(
          'Links simbólicos não são permitidos na origem de conhecimento.',
          KNOWLEDGE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
        );
      }

      if (entry.name.startsWith('.')) {
        continue;
      }

      if (entryStats.isDirectory()) {
        assertSafeKnowledgeDirectory(locator, { sourceId: this.sourceId });
        const directoryRealPath = await this.#resolveRealContainedPath(rootRealPath, entryPath);
        await this.#discoverDirectory(rootRealPath, directoryRealPath, locator, discovered);
        continue;
      }

      if (path.posix.extname(entry.name) !== '.md') {
        continue;
      }

      assertSafeKnowledgeLocator(locator, { sourceId: this.sourceId });

      if (!entryStats.isFile()) {
        throw this.#error(
          'Um documento Markdown deve ser um arquivo regular.',
          KNOWLEDGE_ERROR_CODES.INVALID_DOCUMENT,
        );
      }

      await this.#resolveRealContainedPath(rootRealPath, entryPath);
      discovered.push({
        locator,
        kind: 'FILE',
        sizeBytes: entryStats.size,
      });
    }
  }

  async #resolveRegularFile(rootRealPath: string, locator: string): Promise<string> {
    const candidatePath = resolveContainedPath(rootRealPath, locator, {
      sourceId: this.sourceId,
    });
    const segments = locator.split('/');
    let currentPath = rootRealPath;

    try {
      for (const segment of segments) {
        currentPath = path.join(currentPath, segment);
        const stats = await lstat(currentPath);

        if (stats.isSymbolicLink()) {
          throw this.#error(
            'Links simbólicos não são permitidos na origem de conhecimento.',
            KNOWLEDGE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
          );
        }
      }

      const candidateRealPath = await this.#resolveRealContainedPath(rootRealPath, candidatePath);
      const fileStats = await lstat(candidatePath);

      if (fileStats.isSymbolicLink()) {
        throw this.#error(
          'Links simbólicos não são permitidos na origem de conhecimento.',
          KNOWLEDGE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
        );
      }

      if (!fileStats.isFile()) {
        throw this.#error(
          'O documento solicitado deve ser um arquivo regular.',
          KNOWLEDGE_ERROR_CODES.INVALID_DOCUMENT,
        );
      }

      if (fileStats.size > this.#maxDocumentBytes) {
        throw this.#error(
          'O documento excede o limite de tamanho configurado.',
          KNOWLEDGE_ERROR_CODES.INVALID_DOCUMENT,
        );
      }

      return candidateRealPath;
    } catch (error) {
      if (error instanceof KnowledgeLoaderError) {
        throw error;
      }

      if (filesystemErrorCode(error) === 'ENOENT') {
        throw this.#error(
          'O documento solicitado não foi encontrado.',
          KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_FOUND,
          error,
        );
      }

      throw this.#error(
        'Não foi possível inspecionar o documento solicitado.',
        KNOWLEDGE_ERROR_CODES.READ_FAILED,
        error,
      );
    }
  }

  async #resolveRealContainedPath(rootRealPath: string, candidatePath: string): Promise<string> {
    try {
      const candidateRealPath = await realpath(candidatePath);
      assertPathContained(rootRealPath, candidateRealPath, { sourceId: this.sourceId });
      return candidateRealPath;
    } catch (error) {
      if (error instanceof KnowledgeLoaderError) {
        throw error;
      }

      throw this.#error(
        'Não foi possível validar um caminho da origem.',
        KNOWLEDGE_ERROR_CODES.READ_FAILED,
        error,
      );
    }
  }

  #error(
    message: string,
    code: KnowledgeFilesystemErrorCode,
    cause?: unknown,
  ): KnowledgeLoaderError {
    const safeCause = filesystemErrorCode(cause);

    return new KnowledgeLoaderError(message, {
      code,
      sourceId: this.sourceId,
      ...(safeCause === undefined ? {} : { cause: safeCause }),
    });
  }
}
