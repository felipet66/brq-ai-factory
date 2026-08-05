import type { ReadonlyJsonValue } from './canonical-json';
import type { ArtifactFormat, ArtifactMediaType } from './contracts';

interface ResolvedArtifactModelBase {
  readonly templateId: string;
  readonly name: string;
  readonly filename: string;
  readonly type: string;
  readonly mediaType: ArtifactMediaType;
  readonly templateHash: string;
  readonly format: ArtifactFormat;
}

export interface ResolvedTextArtifactModel extends ResolvedArtifactModelBase {
  readonly format: 'TEXT';
  readonly fragments: readonly string[];
}

export interface ResolvedJsonArtifactModel extends ResolvedArtifactModelBase {
  readonly format: 'JSON';
  readonly value: ReadonlyJsonValue;
}

export type ResolvedArtifactModel = ResolvedTextArtifactModel | ResolvedJsonArtifactModel;
