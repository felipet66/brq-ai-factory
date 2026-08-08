import type { z } from 'zod';

import type {
  promptInspectionKnowledgeSchema,
  promptInspectionPipelineNodeSchema,
  promptInspectionSectionSchema,
} from './schemas';

export type PromptInspectionPipelineNode = z.infer<typeof promptInspectionPipelineNodeSchema>;
export type PromptInspectionSection = z.infer<typeof promptInspectionSectionSchema>;
export type PromptInspectionKnowledge = z.infer<typeof promptInspectionKnowledgeSchema>;
