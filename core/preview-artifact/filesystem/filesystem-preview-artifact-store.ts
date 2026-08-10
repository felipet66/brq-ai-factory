import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  projectApprovedPreviewArtifactDescriptor,
  projectPreviewArtifactDescriptor,
} from '../artifact';
import type {
  PreviewArtifact,
  PreviewArtifactContentStore,
  PreviewArtifactDescriptor,
  PreviewArtifactStoreOptions,
} from '../contracts';
import { PREVIEW_ARTIFACT_ERROR_CODES, PreviewArtifactError } from '../errors';
import { immutableClone } from '../immutability';
import {
  approvedPreviewArtifactSchema,
  previewArtifactCandidateSchema,
  previewArtifactIdSchema,
  previewArtifactSchema,
} from '../schemas';

const MAX_SERIALIZED_BYTES = 2 * 1024 * 1024;
let temporarySequence = 0;

export interface CreateFilesystemPreviewArtifactStoreOptions {
  readonly rootPath: string;
}

function assertNotAborted(options: PreviewArtifactStoreOptions | undefined): void {
  if (options?.signal?.aborted) {
    throw new PreviewArtifactError('A operação do PreviewArtifact foi cancelada.', {
      code: PREVIEW_ARTIFACT_ERROR_CODES.STORE_FAILURE,
    });
  }
}

function validateRoot(rootPath: string): string {
  if (!path.isAbsolute(rootPath)) {
    throw new PreviewArtifactError('A raiz do PreviewArtifactStore deve ser absoluta.', {
      code: PREVIEW_ARTIFACT_ERROR_CODES.STORE_FAILURE,
    });
  }
  const resolved = path.resolve(rootPath);
  if (resolved === path.parse(resolved).root) {
    throw new PreviewArtifactError('A raiz ampla do filesystem não pode ser usada.', {
      code: PREVIEW_ARTIFACT_ERROR_CODES.STORE_FAILURE,
    });
  }
  return resolved;
}

async function ensurePrivateRoot(rootPath: string): Promise<void> {
  let stat;
  try {
    stat = await lstat(rootPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(rootPath, { recursive: true, mode: 0o700 });
    stat = await lstat(rootPath);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PreviewArtifactError(
      'A raiz do PreviewArtifactStore não é um diretório físico seguro.',
      {
        code: PREVIEW_ARTIFACT_ERROR_CODES.STORE_FAILURE,
      },
    );
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new PreviewArtifactError(
      'A raiz existente do PreviewArtifactStore possui permissões excessivas.',
      {
        code: PREVIEW_ARTIFACT_ERROR_CODES.STORE_FAILURE,
      },
    );
  }
}

function artifactPath(rootPath: string, artifactId: string): string {
  const parsed = previewArtifactIdSchema.parse(artifactId);
  return path.join(rootPath, `${parsed}.json`);
}

function temporaryPath(rootPath: string, artifactId: string): string {
  temporarySequence += 1;
  return path.join(rootPath, `.${artifactId}.${process.pid}.${temporarySequence}.tmp`);
}

async function writeAtomic(rootPath: string, artifact: PreviewArtifact): Promise<void> {
  const serialized = JSON.stringify(artifact);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SERIALIZED_BYTES) {
    throw new PreviewArtifactError('O envelope serializado do PreviewArtifact excede o limite.', {
      code: PREVIEW_ARTIFACT_ERROR_CODES.LIMIT_EXCEEDED,
      artifactId: artifact.artifactId,
    });
  }
  const temporary = temporaryPath(rootPath, artifact.artifactId);
  const destination = artifactPath(rootPath, artifact.artifactId);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(serialized, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, destination);
    await chmod(destination, 0o600);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function readArtifact(rootPath: string, artifactId: string): Promise<PreviewArtifact | null> {
  const location = artifactPath(rootPath, artifactId);
  let stat;
  try {
    stat = await lstat(location);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SERIALIZED_BYTES) {
    throw new PreviewArtifactError('O arquivo físico do PreviewArtifact não é seguro.', {
      code: PREVIEW_ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
      artifactId,
    });
  }
  const handle = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const serialized = await handle.readFile({ encoding: 'utf8' });
    const parsed = previewArtifactSchema.safeParse(JSON.parse(serialized) as unknown);
    if (!parsed.success || parsed.data.artifactId !== artifactId) {
      throw new PreviewArtifactError('A integridade física do PreviewArtifact é inválida.', {
        code: PREVIEW_ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
        artifactId,
        cause: parsed.success ? undefined : parsed.error,
      });
    }
    return immutableClone(parsed.data);
  } catch (error) {
    if (error instanceof PreviewArtifactError) throw error;
    throw new PreviewArtifactError('O PreviewArtifact armazenado não pôde ser lido.', {
      code: PREVIEW_ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
      artifactId,
      cause: error,
    });
  } finally {
    await handle.close();
  }
}

export function createFilesystemPreviewArtifactStore(
  options: CreateFilesystemPreviewArtifactStoreOptions,
): PreviewArtifactContentStore {
  const rootPath = validateRoot(options.rootPath);
  const locks = new Map<string, Promise<unknown>>();
  const tombstones = new Map<string, PreviewArtifactDescriptor>();

  const withLock = async <T>(artifactId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = locks.get(artifactId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    locks.set(artifactId, current);
    try {
      return await current;
    } finally {
      if (locks.get(artifactId) === current) locks.delete(artifactId);
    }
  };

  const initialized = ensurePrivateRoot(rootPath);

  return {
    async stage(candidate, storeOptions) {
      assertNotAborted(storeOptions);
      await initialized;
      const parsed = immutableClone(previewArtifactCandidateSchema.parse(candidate));
      return withLock(parsed.artifactId, async () => {
        assertNotAborted(storeOptions);
        const existing = await readArtifact(rootPath, parsed.artifactId);
        if (existing !== null) {
          if (existing.hashes.artifactHash !== parsed.hashes.artifactHash) {
            throw new PreviewArtifactError('ArtifactId já existe com conteúdo divergente.', {
              code: PREVIEW_ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
              artifactId: parsed.artifactId,
            });
          }
          return projectPreviewArtifactDescriptor(existing);
        }
        await writeAtomic(rootPath, parsed);
        return projectPreviewArtifactDescriptor(parsed);
      });
    },

    async approve(artifact, storeOptions) {
      assertNotAborted(storeOptions);
      await initialized;
      const parsed = immutableClone(approvedPreviewArtifactSchema.parse(artifact));
      return withLock(parsed.artifactId, async () => {
        const existing = await readArtifact(rootPath, parsed.artifactId);
        if (existing === null) {
          throw new PreviewArtifactError('O PreviewArtifact candidato não foi encontrado.', {
            code: PREVIEW_ARTIFACT_ERROR_CODES.NOT_FOUND,
            artifactId: parsed.artifactId,
          });
        }
        if (
          existing.hashes.artifactHash !== parsed.hashes.artifactHash ||
          !['CANDIDATE', 'APPROVED'].includes(existing.status)
        ) {
          throw new PreviewArtifactError('A aprovação não corresponde ao artifact candidato.', {
            code: PREVIEW_ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
            artifactId: parsed.artifactId,
          });
        }
        if (existing.status === 'APPROVED') {
          if (!isDeepStrictEqual(existing, parsed)) {
            throw new PreviewArtifactError('A aprovação existente é imutável.', {
              code: PREVIEW_ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
              artifactId: parsed.artifactId,
            });
          }
          return projectApprovedPreviewArtifactDescriptor(existing);
        }
        const stagedCandidate = previewArtifactCandidateSchema.parse({
          ...parsed,
          status: 'CANDIDATE',
          approval: null,
          hashes: { ...parsed.hashes, approvalHash: null },
        });
        if (!isDeepStrictEqual(existing, stagedCandidate)) {
          throw new PreviewArtifactError('A aprovação diverge do artifact staged.', {
            code: PREVIEW_ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
            artifactId: parsed.artifactId,
          });
        }
        await writeAtomic(rootPath, parsed);
        return projectApprovedPreviewArtifactDescriptor(parsed);
      });
    },

    async readApproved(artifactId, storeOptions) {
      assertNotAborted(storeOptions);
      await initialized;
      const artifact = await withLock(artifactId, () => readArtifact(rootPath, artifactId));
      if (artifact?.status !== 'APPROVED') return null;
      return immutableClone(approvedPreviewArtifactSchema.parse(artifact));
    },

    async consume(artifactId, consumedAt, storeOptions) {
      assertNotAborted(storeOptions);
      await initialized;
      return withLock(artifactId, async () => {
        const artifact = await readArtifact(rootPath, artifactId);
        if (artifact?.status !== 'APPROVED') {
          throw new PreviewArtifactError('Somente um artifact aprovado pode ser consumido.', {
            code:
              artifact === null
                ? PREVIEW_ARTIFACT_ERROR_CODES.NOT_FOUND
                : PREVIEW_ARTIFACT_ERROR_CODES.INVALID_TRANSITION,
            artifactId,
          });
        }
        const consumed = immutableClone(
          previewArtifactSchema.parse({ ...artifact, status: 'CONSUMED', consumedAt }),
        );
        await writeAtomic(rootPath, consumed);
        return projectPreviewArtifactDescriptor(consumed);
      });
    },

    async expire(artifactId, _expiredAt, storeOptions) {
      assertNotAborted(storeOptions);
      await initialized;
      return withLock(artifactId, async () => {
        const artifact = await readArtifact(rootPath, artifactId);
        if (artifact === null) {
          throw new PreviewArtifactError('O PreviewArtifact não foi encontrado.', {
            code: PREVIEW_ARTIFACT_ERROR_CODES.NOT_FOUND,
            artifactId,
          });
        }
        if (!['CANDIDATE', 'APPROVED'].includes(artifact.status)) {
          throw new PreviewArtifactError('O artifact não pode expirar neste estado.', {
            code: PREVIEW_ARTIFACT_ERROR_CODES.INVALID_TRANSITION,
            artifactId,
          });
        }
        const expired = immutableClone(
          previewArtifactSchema.parse({ ...artifact, status: 'EXPIRED' }),
        );
        await writeAtomic(rootPath, expired);
        return projectPreviewArtifactDescriptor(expired);
      });
    },

    async remove(artifactId, deletedAt, storeOptions) {
      assertNotAborted(storeOptions);
      await initialized;
      return withLock(artifactId, async () => {
        const tombstone = tombstones.get(artifactId);
        if (tombstone !== undefined) return immutableClone(tombstone);
        const artifact = await readArtifact(rootPath, artifactId);
        if (artifact === null) return null;
        const deleted = immutableClone(
          previewArtifactSchema.parse({
            ...artifact,
            status: 'DELETED',
            consumedAt: null,
            deletedAt,
          }),
        );
        const descriptor = projectPreviewArtifactDescriptor(deleted);
        await rm(artifactPath(rootPath, artifactId), { force: true });
        tombstones.set(artifactId, descriptor);
        return immutableClone(descriptor);
      });
    },
  };
}
