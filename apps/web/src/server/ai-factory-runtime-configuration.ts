import path from 'node:path';

import { KNOWLEDGE_MANIFEST, type KnowledgeSource } from '@brq/knowledge-loader';
import { FilesystemKnowledgeSource } from '@brq/knowledge-loader/filesystem';

export const AI_FACTORY_PROMPT_BUILDER_MAX_BYTES = 512 * 1024;

const AI_FACTORY_KNOWLEDGE_SOURCE_ID = 'knowledge-filesystem';

function validateKnowledgeRoot(rootPath: string): string {
  if (!path.isAbsolute(rootPath)) {
    throw new Error('A raiz de knowledge deve ser um caminho absoluto.');
  }
  return rootPath;
}

export function resolveAIFactoryKnowledgeRoot(
  environment: NodeJS.ProcessEnv,
  explicitRoot?: string,
): string {
  if (explicitRoot !== undefined) return validateKnowledgeRoot(explicitRoot);

  const configured = environment.BRQ_KNOWLEDGE_ROOT?.trim();
  if (configured !== undefined && configured.length > 0) {
    return validateKnowledgeRoot(configured);
  }

  const currentDirectory = process.cwd();
  const fromWebWorkspace =
    path.basename(currentDirectory) === 'web' &&
    path.basename(path.dirname(currentDirectory)) === 'apps';
  return path.resolve(currentDirectory, fromWebWorkspace ? '../../knowledge' : 'knowledge');
}

export function createAIFactoryKnowledgeSource(rootPath: string): KnowledgeSource {
  return new FilesystemKnowledgeSource({
    sourceId: AI_FACTORY_KNOWLEDGE_SOURCE_ID,
    rootPath: validateKnowledgeRoot(rootPath),
    allowedLocators: KNOWLEDGE_MANIFEST.documents.map((document) => document.locator),
  });
}
