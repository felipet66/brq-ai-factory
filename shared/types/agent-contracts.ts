import type { z } from 'zod';

import type {
  agentResultStatusSchema,
  baseAgentInputSchema,
  baseAgentOutputSchema,
} from '../schemas/agent-contracts.schema';
import type { agentNameSchema } from '../schemas/common.schema';

export type AgentName = z.infer<typeof agentNameSchema>;
export type AgentResultStatus = z.infer<typeof agentResultStatusSchema>;
export type BaseAgentInput = z.infer<typeof baseAgentInputSchema>;
export type BaseAgentOutput = z.infer<typeof baseAgentOutputSchema>;
