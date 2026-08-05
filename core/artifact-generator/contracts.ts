import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type { ArtifactGeneratorConfiguration } from './configuration';
import type {
  artifactFormatSchema,
  artifactGenerationSourceSchema,
  artifactGenerationMetadataSchema,
  artifactGenerationRequestSchema,
  artifactGenerationResultSchema,
  artifactSourceContractSchema,
  artifactSpecificationSchema,
  artifactBindingSchema,
  artifactMediaTypeSchema,
  artifactTemplateSchema,
  bindingFragmentSchema,
  bindingPathSchema,
  bindingPathSegmentSchema,
  bindingSerializationSchema,
  generatedArtifactMetadataSchema,
  generatedArtifactSchema,
  jsonArtifactTemplateSchema,
  literalFragmentSchema,
  textArtifactTemplateSchema,
  textTemplateFragmentSchema,
} from './schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ArtifactFormat = DeepReadonly<z.infer<typeof artifactFormatSchema>>;
export type ArtifactMediaType = DeepReadonly<z.infer<typeof artifactMediaTypeSchema>>;
export type BindingSerialization = DeepReadonly<z.infer<typeof bindingSerializationSchema>>;
export type BindingPathSegment = DeepReadonly<z.infer<typeof bindingPathSegmentSchema>>;
export type BindingPath = DeepReadonly<z.infer<typeof bindingPathSchema>>;
export type ArtifactBinding = DeepReadonly<z.infer<typeof artifactBindingSchema>>;
export type LiteralFragment = DeepReadonly<z.infer<typeof literalFragmentSchema>>;
export type BindingFragment = DeepReadonly<z.infer<typeof bindingFragmentSchema>>;
export type TextTemplateFragment = DeepReadonly<z.infer<typeof textTemplateFragmentSchema>>;
export type TextArtifactTemplate = DeepReadonly<z.infer<typeof textArtifactTemplateSchema>>;
export type JsonArtifactTemplate = DeepReadonly<z.infer<typeof jsonArtifactTemplateSchema>>;
export type ArtifactTemplate = DeepReadonly<z.infer<typeof artifactTemplateSchema>>;
export type ArtifactSourceContract = DeepReadonly<z.infer<typeof artifactSourceContractSchema>>;
export type ArtifactSpecification = DeepReadonly<z.infer<typeof artifactSpecificationSchema>>;
export type ArtifactGenerationRequest = DeepReadonly<
  z.infer<typeof artifactGenerationRequestSchema>
>;
export type GeneratedArtifactMetadata = DeepReadonly<
  z.infer<typeof generatedArtifactMetadataSchema>
>;
export type GeneratedArtifact = DeepReadonly<z.infer<typeof generatedArtifactSchema>>;
export type ArtifactGenerationSource = DeepReadonly<z.infer<typeof artifactGenerationSourceSchema>>;
export type ArtifactGenerationMetadata = DeepReadonly<
  z.infer<typeof artifactGenerationMetadataSchema>
>;
export type ArtifactGenerationResult = DeepReadonly<z.infer<typeof artifactGenerationResultSchema>>;

export interface CreateArtifactGeneratorOptions {
  readonly configuration?: Partial<ArtifactGeneratorConfiguration>;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface ArtifactGenerator {
  generate(request: ArtifactGenerationRequest): ArtifactGenerationResult;
}
