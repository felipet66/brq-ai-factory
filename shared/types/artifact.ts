import type { z } from 'zod';

import type {
  artifactDraftSchema,
  artifactCreateInputSchema,
  artifactProvenanceSchema,
  artifactSchema,
} from '../schemas/artifact.schema';

export type ArtifactDraft = z.infer<typeof artifactDraftSchema>;
export type ArtifactCreateInput = z.infer<typeof artifactCreateInputSchema>;
export type ArtifactProvenance = z.infer<typeof artifactProvenanceSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
