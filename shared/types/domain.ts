import type { z } from 'zod';

import type {
  agentExecutionSchema,
  agentExecutionCreateInputSchema,
  agentExecutionStatusSchema,
  executionSchema,
  executionCreateInputSchema,
  executionStatusSchema,
  projectSchema,
  projectCreateInputSchema,
  projectStatusSchema,
  tokenUsageSchema,
} from '../schemas/domain.schema';

export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;
export type AgentExecutionStatus = z.infer<typeof agentExecutionStatusSchema>;
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type ProjectCreateInput = z.infer<typeof projectCreateInputSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ExecutionCreateInput = z.infer<typeof executionCreateInputSchema>;
export type Execution = z.infer<typeof executionSchema>;
export type AgentExecutionCreateInput = z.infer<typeof agentExecutionCreateInputSchema>;
export type AgentExecution = z.infer<typeof agentExecutionSchema>;
