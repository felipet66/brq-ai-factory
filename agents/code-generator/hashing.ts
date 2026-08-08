import { Buffer } from 'node:buffer';

import {
  calculateCanonicalJsonHash,
  calculatePromptHash,
  canonicalizeJson,
} from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';

export const CODE_BUNDLE_CONTENT_HASH_DOMAIN = 'brq.code-bundle-content.v1\n' as const;

function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function calculateTechnicalSpecificationHash(specification: unknown): string {
  return `sha256:${calculateCanonicalJsonHash(asJsonValue(specification))}`;
}

export function calculateGeneratedContentHash(content: string): string {
  return calculatePromptHash(content);
}

export interface GeneratedFileHashInput {
  readonly path: string;
  readonly content: string;
  readonly encoding: string;
  readonly mediaType: string;
  readonly purpose: string;
  readonly sourceModuleIds: readonly string[];
  readonly sourcePlanItemIds: readonly string[];
}

export function calculateGeneratedFileHash(file: GeneratedFileHashInput): string {
  const byteLength = Buffer.byteLength(file.content, 'utf8');
  const contentHash = calculateGeneratedContentHash(file.content);
  return calculateCanonicalJsonHash(
    asJsonValue({
      path: file.path,
      encoding: file.encoding,
      mediaType: file.mediaType,
      purpose: file.purpose,
      sourceModuleIds: file.sourceModuleIds,
      sourcePlanItemIds: file.sourcePlanItemIds,
      byteLength,
      contentHash,
    }),
  );
}

export interface BundleContentFileInput {
  readonly path: string;
  readonly encoding: string;
  readonly mediaType: string;
  readonly purpose: string;
  readonly byteLength: number;
  readonly contentHash: string;
}

export interface GeneratedManifestFileInput extends BundleContentFileInput {
  readonly sourceModuleIds: readonly string[];
  readonly sourcePlanItemIds: readonly string[];
  readonly fileHash: string;
}

export function projectGeneratedManifestFile<T extends GeneratedManifestFileInput>(
  file: T,
): Pick<
  T,
  | 'path'
  | 'encoding'
  | 'mediaType'
  | 'purpose'
  | 'sourceModuleIds'
  | 'sourcePlanItemIds'
  | 'byteLength'
  | 'contentHash'
  | 'fileHash'
> {
  return {
    path: file.path,
    encoding: file.encoding,
    mediaType: file.mediaType,
    purpose: file.purpose,
    sourceModuleIds: file.sourceModuleIds,
    sourcePlanItemIds: file.sourcePlanItemIds,
    byteLength: file.byteLength,
    contentHash: file.contentHash,
    fileHash: file.fileHash,
  };
}

export function calculateBundleContentHash(files: readonly BundleContentFileInput[]): string {
  const projection = [...files]
    .sort((left, right) => compareCodeUnits(left.path, right.path))
    .map((file) => ({
      path: file.path,
      encoding: file.encoding,
      mediaType: file.mediaType,
      purpose: file.purpose,
      byteLength: file.byteLength,
      contentHash: file.contentHash,
    }));
  return calculatePromptHash(
    `${CODE_BUNDLE_CONTENT_HASH_DOMAIN}${canonicalizeJson(asJsonValue(projection))}`,
  );
}

export function calculateGeneratedManifestHash(manifestWithoutHash: unknown): string {
  return calculateCanonicalJsonHash(asJsonValue(manifestWithoutHash));
}

export function calculateCodeGenerationLineageHash(lineage: unknown): string {
  return calculateCanonicalJsonHash(asJsonValue(lineage));
}

export function calculateCodeGenerationProvenanceHash(provenance: unknown): string {
  return calculateCanonicalJsonHash(asJsonValue(provenance));
}

export interface GeneratedBundleHashInput {
  readonly bundleVersion: string;
  readonly contractVersion: string;
  readonly technicalSpecificationHash: string;
  readonly bundleContentHash: string;
  readonly manifestHash: string;
  readonly lineageHash: string;
  readonly provenanceHash: string;
}

export function calculateGeneratedBundleHash(input: GeneratedBundleHashInput): string {
  return calculateCanonicalJsonHash(asJsonValue(input));
}

export interface GenerationHashInput {
  readonly bundleVersion: string;
  readonly contractVersion: string;
  readonly bundleHash: string;
  readonly bundleContentHash: string;
  readonly promptHash: string;
  readonly responseHash: string;
  readonly validationHash: string;
  readonly assetBundleHash: string;
}

export function calculateCodeGenerationHash(input: GenerationHashInput): string {
  return calculateCanonicalJsonHash(asJsonValue(input));
}
