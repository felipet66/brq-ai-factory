import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { KNOWLEDGE_ERROR_CODES, KnowledgeLoaderError } from '../errors';
import { defineKnowledgeSourceContract } from '../testing/knowledge-source-contract';
import { FilesystemKnowledgeSource } from './filesystem-knowledge-source';
import { assertPathContained } from './path-safety';

const SOURCE_ID = 'local-knowledge';
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'knowledge-source-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createSource(
  rootPath: string,
  allowedLocators: readonly string[],
  maxDocumentBytes?: number,
): FilesystemKnowledgeSource {
  return new FilesystemKnowledgeSource({
    sourceId: SOURCE_ID,
    rootPath,
    allowedLocators,
    ...(maxDocumentBytes === undefined ? {} : { maxDocumentBytes }),
  });
}

async function expectKnowledgeError(
  operation: Promise<unknown>,
  code: (typeof KNOWLEDGE_ERROR_CODES)[keyof typeof KNOWLEDGE_ERROR_CODES],
): Promise<KnowledgeLoaderError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeLoaderError);
    expect(error).toMatchObject({ code, sourceId: SOURCE_ID });
    return error as KnowledgeLoaderError;
  }

  throw new Error('Era esperado um KnowledgeLoaderError.');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

defineKnowledgeSourceContract('FilesystemKnowledgeSource', async () => {
  const root = await createTemporaryDirectory();
  const locator = 'contract.md';
  const content = '# Contract\nFilesystem source';
  await writeFile(path.join(root, locator), content, 'utf8');

  return {
    source: createSource(root, [locator]),
    locator,
    content,
  };
});

describe('FilesystemKnowledgeSource', () => {
  it('exige uma raiz absoluta', () => {
    expect(() => createSource('knowledge', [])).toThrowError(
      expect.objectContaining({
        code: KNOWLEDGE_ERROR_CODES.INVALID_ROOT,
        sourceId: SOURCE_ID,
      }),
    );
  });

  it('valida identificador, limite e allowlist na configuração da instância', async () => {
    const root = await createTemporaryDirectory();

    expect(
      () =>
        new FilesystemKnowledgeSource({
          sourceId: '../unsafe',
          rootPath: root,
          allowedLocators: [],
        }),
    ).toThrowError(expect.objectContaining({ code: KNOWLEDGE_ERROR_CODES.INVALID_ROOT }));
    expect(
      () =>
        new FilesystemKnowledgeSource({
          sourceId: 'unsafe\n',
          rootPath: root,
          allowedLocators: [],
        }),
    ).toThrowError(expect.objectContaining({ code: KNOWLEDGE_ERROR_CODES.INVALID_ROOT }));
    expect(() => createSource(root, [], 0)).toThrowError(
      expect.objectContaining({ code: KNOWLEDGE_ERROR_CODES.INVALID_ROOT }),
    );
    expect(() => createSource(root, ['../unsafe.md'])).toThrowError(
      expect.objectContaining({ code: KNOWLEDGE_ERROR_CODES.PATH_TRAVERSAL }),
    );
  });

  it('rejeita contenção física fora da raiz sem revelar os caminhos', async () => {
    const root = await createTemporaryDirectory();
    const outside = await createTemporaryDirectory();

    expect(() =>
      assertPathContained(root, path.join(outside, 'document.md'), {
        sourceId: SOURCE_ID,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: KNOWLEDGE_ERROR_CODES.PATH_TRAVERSAL,
        sourceId: SOURCE_ID,
      }),
    );
  });

  it('rejeita uma raiz inexistente sem expor o caminho absoluto no erro', async () => {
    const parent = await createTemporaryDirectory();
    const missingRoot = path.join(parent, 'missing');
    const error = await expectKnowledgeError(
      createSource(missingRoot, []).discover(),
      KNOWLEDGE_ERROR_CODES.INVALID_ROOT,
    );

    expect(error.message).not.toContain(parent);
    expect(error.cause).not.toContain(parent);
  });

  it('rejeita uma raiz que não seja diretório', async () => {
    const root = await createTemporaryDirectory();
    const fileRoot = path.join(root, 'root.md');
    await writeFile(fileRoot, '# Root\n', 'utf8');

    await expectKnowledgeError(
      createSource(fileRoot, ['root.md']).discover(),
      KNOWLEDGE_ERROR_CODES.INVALID_ROOT,
    );
  });

  it('rejeita uma raiz que seja link simbólico', async () => {
    const parent = await createTemporaryDirectory();
    const target = path.join(parent, 'target');
    const linkedRoot = path.join(parent, 'linked-root');
    await mkdir(target);
    await symlink(target, linkedRoot, 'dir');

    await expectKnowledgeError(
      createSource(linkedRoot, []).discover(),
      KNOWLEDGE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
    );
  });

  it('descobre somente Markdown seguros em ordem determinística', async () => {
    const root = await createTemporaryDirectory();
    await mkdir(path.join(root, 'nested'));
    await mkdir(path.join(root, '.hidden-directory'));
    await writeFile(path.join(root, 'z-last.md'), '# Z\n', 'utf8');
    await writeFile(path.join(root, 'a-first.md'), '# A\n', 'utf8');
    await writeFile(path.join(root, 'nested', 'middle.md'), '# M\n', 'utf8');
    await writeFile(path.join(root, 'ignored.txt'), 'ignored', 'utf8');
    await writeFile(path.join(root, '.hidden.md'), '# Hidden\n', 'utf8');
    await writeFile(path.join(root, '.hidden-directory', 'ignored.md'), '# Hidden\n', 'utf8');

    await expect(createSource(root, []).discover()).resolves.toEqual([
      { kind: 'FILE', locator: 'a-first.md', sizeBytes: 4 },
      { kind: 'FILE', locator: 'nested/middle.md', sizeBytes: 4 },
      { kind: 'FILE', locator: 'z-last.md', sizeBytes: 4 },
    ]);
  });

  it('retorna uma cópia Uint8Array dos bytes do documento autorizado', async () => {
    const root = await createTemporaryDirectory();
    await mkdir(path.join(root, 'ADR'));
    await writeFile(path.join(root, 'ADR', 'ADR-001.md'), '# ADR\n', 'utf8');

    const bytes = await createSource(root, ['ADR/ADR-001.md']).read('ADR/ADR-001.md');

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(bytes).toString('utf8')).toBe('# ADR\n');
  });

  it('rejeita um documento seguro fora da allowlist', async () => {
    const root = await createTemporaryDirectory();
    await writeFile(path.join(root, 'unlisted.md'), '# Unlisted\n', 'utf8');

    await expectKnowledgeError(
      createSource(root, []).read('unlisted.md'),
      KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_AUTHORIZED,
    );
  });

  it.each([
    ['../secret.md', KNOWLEDGE_ERROR_CODES.PATH_TRAVERSAL],
    ['/absolute.md', KNOWLEDGE_ERROR_CODES.PATH_TRAVERSAL],
    ['C:\\absolute.md', KNOWLEDGE_ERROR_CODES.PATH_TRAVERSAL],
    ['C:drive-relative.md', KNOWLEDGE_ERROR_CODES.PATH_TRAVERSAL],
    ['nested\\document.md', KNOWLEDGE_ERROR_CODES.PATH_TRAVERSAL],
    ['nested/./document.md', KNOWLEDGE_ERROR_CODES.PATH_TRAVERSAL],
    ['nested//document.md', KNOWLEDGE_ERROR_CODES.PATH_TRAVERSAL],
    ['.hidden.md', KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_AUTHORIZED],
    ['.hidden/document.md', KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_AUTHORIZED],
    ['document.txt', KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_AUTHORIZED],
    [' document.md', KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_AUTHORIZED],
    ['document.md ', KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_AUTHORIZED],
    ['document.md\n', KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_AUTHORIZED],
    ['document.md\u007f', KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_AUTHORIZED],
    ['', KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_AUTHORIZED],
  ])('rejeita locator inseguro %j', async (locator, expectedCode) => {
    const root = await createTemporaryDirectory();

    await expectKnowledgeError(createSource(root, []).read(locator), expectedCode);
  });

  it('rejeita um link simbólico para documento dentro da raiz', async () => {
    const root = await createTemporaryDirectory();
    await writeFile(path.join(root, 'target.md'), '# Target\n', 'utf8');
    await symlink('target.md', path.join(root, 'linked.md'), 'file');

    await expectKnowledgeError(
      createSource(root, ['linked.md']).read('linked.md'),
      KNOWLEDGE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
    );
  });

  it('rejeita um link simbólico para documento fora da raiz', async () => {
    const root = await createTemporaryDirectory();
    const outside = await createTemporaryDirectory();
    const outsideDocument = path.join(outside, 'outside.md');
    await writeFile(outsideDocument, '# Outside\n', 'utf8');
    await symlink(outsideDocument, path.join(root, 'external.md'), 'file');

    const error = await expectKnowledgeError(
      createSource(root, ['external.md']).read('external.md'),
      KNOWLEDGE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
    );
    expect(error.message).not.toContain(outside);
  });

  it('rejeita links simbólicos em diretórios ancestrais do documento', async () => {
    const root = await createTemporaryDirectory();
    await mkdir(path.join(root, 'real-directory'));
    await writeFile(path.join(root, 'real-directory', 'document.md'), '# Document\n', 'utf8');
    await symlink('real-directory', path.join(root, 'linked-directory'), 'dir');

    await expectKnowledgeError(
      createSource(root, ['linked-directory/document.md']).read('linked-directory/document.md'),
      KNOWLEDGE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
    );
  });

  it('falha o discovery ao encontrar link simbólico interno', async () => {
    const root = await createTemporaryDirectory();
    await writeFile(path.join(root, 'target.md'), '# Target\n', 'utf8');
    await symlink('target.md', path.join(root, 'linked.md'), 'file');

    await expectKnowledgeError(
      createSource(root, []).discover(),
      KNOWLEDGE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
    );
  });

  it('falha o discovery ao encontrar link simbólico externo', async () => {
    const root = await createTemporaryDirectory();
    const outside = await createTemporaryDirectory();
    const outsideDocument = path.join(outside, 'outside.md');
    await writeFile(outsideDocument, '# Outside\n', 'utf8');
    await symlink(outsideDocument, path.join(root, 'external.md'), 'file');

    await expectKnowledgeError(
      createSource(root, []).discover(),
      KNOWLEDGE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
    );
  });

  it('rejeita diretório com sufixo .md como documento', async () => {
    const root = await createTemporaryDirectory();
    await mkdir(path.join(root, 'not-a-file.md'));

    await expectKnowledgeError(
      createSource(root, ['not-a-file.md']).read('not-a-file.md'),
      KNOWLEDGE_ERROR_CODES.INVALID_DOCUMENT,
    );
  });

  it('aplica o limite de bytes configurado na instância sem truncar', async () => {
    const root = await createTemporaryDirectory();
    await writeFile(path.join(root, 'document.md'), '1234', 'utf8');
    const source = createSource(root, ['document.md'], 3);

    await expectKnowledgeError(source.read('document.md'), KNOWLEDGE_ERROR_CODES.INVALID_DOCUMENT);
  });

  it('traduz documento ausente sem incluir o caminho físico no erro', async () => {
    const root = await createTemporaryDirectory();
    const error = await expectKnowledgeError(
      createSource(root, ['missing.md']).read('missing.md'),
      KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_FOUND,
    );

    expect(error.message).not.toContain(root);
    expect(error.cause).not.toContain(root);
  });
});
