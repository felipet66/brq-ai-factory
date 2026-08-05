import type { z } from 'zod';

import type {
  artifactDraftSchema,
  artifactProvenanceSchema,
  artifactSchema,
} from '../schemas/artifact.schema';

export type ArtifactDraft = z.infer<typeof artifactDraftSchema>;
export type ArtifactProvenance = z.infer<typeof artifactProvenanceSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
