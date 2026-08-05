import { artifactDraftSchema } from '@brq/shared/schemas/artifact.schema';

import { prettyPrintCanonicalJson } from './canonical-json';
import { calculateContentHash, utf8ByteLength } from './content-hashing';
import type { GeneratedArtifact } from './contracts';
import { ARTIFACT_GENERATOR_ERROR_CODES, ArtifactGeneratorError } from './errors';
import { deepFreeze } from './immutability';
import type { ResolvedArtifactModel } from './resolved-artifact-model';
import { calculateDraftHash } from './structural-hashing';

export function renderResolvedArtifact(
  model: ResolvedArtifactModel,
  maxArtifactBytes: number,
  durationMs: number,
): GeneratedArtifact {
  const content =
    model.format === 'TEXT'
      ? model.fragments.join('')
      : `${prettyPrintCanonicalJson(model.value)}\n`;

  if (content.trim().length === 0) {
    throw new ArtifactGeneratorError('O template produziu conteúdo vazio.', {
      code: ARTIFACT_GENERATOR_ERROR_CODES.EMPTY_CONTENT,
      stage: 'RENDERING',
      durationMs,
      templateId: model.templateId,
    });
  }

  const byteLength = utf8ByteLength(content);

  if (byteLength > maxArtifactBytes) {
    throw new ArtifactGeneratorError('O artifact excede o limite de bytes configurado.', {
      code: ARTIFACT_GENERATOR_ERROR_CODES.CONTENT_LIMIT_EXCEEDED,
      stage: 'BUDGET_VALIDATION',
      durationMs,
      templateId: model.templateId,
    });
  }

  const draftResult = artifactDraftSchema.safeParse({
    name: model.name,
    filename: model.filename,
    type: model.type,
    content,
  });

  if (!draftResult.success) {
    throw new ArtifactGeneratorError('O template produziu um ArtifactDraft inválido.', {
      code: ARTIFACT_GENERATOR_ERROR_CODES.INVALID_ARTIFACT_DRAFT,
      stage: 'DRAFT_VALIDATION',
      durationMs,
      templateId: model.templateId,
      cause: draftResult.error,
    });
  }

  const draft = draftResult.data;
  return deepFreeze({
    draft,
    metadata: {
      templateId: model.templateId,
      format: model.format,
      mediaType: model.mediaType,
      templateHash: model.templateHash,
      contentHash: calculateContentHash(content),
      draftHash: calculateDraftHash(draft),
      byteLength,
    },
  });
}
