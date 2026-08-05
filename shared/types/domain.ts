import type { z } from 'zod';

import type {
  agentExecutionSchema,
  agentExecutionStatusSchema,
  executionSchema,
  executionStatusSchema,
  projectSchema,
  projectStatusSchema,
  tokenUsageSchema,
} from '../schemas/domain.schema';

export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;
export type AgentExecutionStatus = z.infer<typeof agentExecutionStatusSchema>;
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Execution = z.infer<typeof executionSchema>;
export type AgentExecution = z.infer<typeof agentExecutionSchema>;
