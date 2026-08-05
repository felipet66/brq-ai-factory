import { aiResponseFinishReasonSchema } from '@brq/ai-provider';
import {
  canonicalizeJson,
  calculatePromptHash,
  promptConstraintSchema,
  promptContextInputSchema,
  promptHashSchema,
  promptOutputContractSchema,
  promptResultSchema,
  promptRuleSetSchema,
  promptTemplateSchema,
  promptVariableSchema,
} from '@brq/prompt-builder';
import {
  agentNameSchema,
  identifierSchema,
  semanticVersionSchema,
} from '@brq/shared/schemas/common.schema';
import { tokenUsageSchema } from '@brq/shared/schemas/domain.schema';
import { jsonValueSchema } from '@brq/shared/schemas/json-value.schema';
import { z } from 'zod';

import { AGENT_RUN_ERROR_CODES, AGENT_RUN_STAGES } from './errors';

export const executionMetadataSchema = z
  .object({
    executionId: identifierSchema,
    agentExecutionId: identifierSchema,
    agent: agentNameSchema,
    attempt: z.number().int().positive(),
    agentVersion: semanticVersionSchema,
  })
  .strict();

export const agentRunContextSchema = z
  .object({
    execution: executionMetadataSchema,
    requestId: identifierSchema.optional(),
    traceId: identifierSchema.optional(),
  })
  .strict();

export const promptRequestSchema = z
  .object({
    template: promptTemplateSchema,
    ruleSets: z.array(promptRuleSetSchema),
    contexts: z.array(promptContextInputSchema),
    variables: z.array(promptVariableSchema),
    constraints: z.array(promptConstraintSchema),
    outputContract: promptOutputContractSchema,
    maxBytes: z.number().int().positive().optional(),
  })
  .strict();

export const agentRunRequestSchema = z
  .object({
    context: agentRunContextSchema,
    prompt: promptRequestSchema,
    model: z.string().trim().min(1).max(200),
    maxOutputTokens: z.number().int().positive().optional(),
    timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.context.execution.agent !== request.prompt.template.agent) {
      context.addIssue({
        code: 'custom',
        message: 'O agente da execução deve corresponder ao agente do prompt.',
        path: ['prompt', 'template', 'agent'],
      });
    }
  });

export const promptMetadataSchema = z
  .object({
    metadata: promptResultSchema.shape.metadata,
    budget: promptResultSchema.shape.budget,
  })
  .strict();

export const runnerObservedMetricsSchema = z
  .object({
    totalDurationMs: z.number().int().nonnegative(),
    promptBuilderDurationMs: z.number().int().nonnegative(),
    providerDurationMs: z.number().int().nonnegative(),
    bytesSent: z.number().int().nonnegative(),
    bytesReceived: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((metrics, context) => {
    if (
      metrics.totalDurationMs < metrics.promptBuilderDurationMs ||
      metrics.totalDurationMs < metrics.providerDurationMs
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A duração total não pode ser menor que a duração de uma fase observada.',
      });
    }
  });

export const providerReportedMetricsSchema = z
  .object({
    durationMs: z.number().int().nonnegative(),
    attempts: z.number().int().positive(),
    usage: tokenUsageSchema,
  })
  .strict();

export const agentRunMetricsSchema = z
  .object({
    observed: runnerObservedMetricsSchema,
    reported: providerReportedMetricsSchema,
  })
  .strict();

export const providerMetadataSchema = z
  .object({
    provider: z.string().trim().min(1).max(80),
    requestedModel: z.string().trim().min(1).max(200),
    responseModel: z.string().trim().min(1).max(200),
    responseId: z.string().trim().min(1).max(256).nullable(),
  })
  .strict();

export const agentRunOutputSchema = z
  .object({
    content: z.string(),
    structuredData: jsonValueSchema.nullable(),
    finishReason: aiResponseFinishReasonSchema,
    responseHash: promptHashSchema,
  })
  .strict();

export const agentRunResultSchema = z
  .object({
    context: agentRunContextSchema,
    prompt: promptMetadataSchema,
    outputContract: promptOutputContractSchema,
    output: agentRunOutputSchema,
    provider: providerMetadataSchema,
    metrics: agentRunMetricsSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.context.execution.agent !== result.prompt.metadata.agent) {
      context.addIssue({
        code: 'custom',
        message: 'O agente da execução deve corresponder aos metadados do prompt.',
        path: ['prompt', 'metadata', 'agent'],
      });
    }

    const expectedOutputContractHash = calculatePromptHash(canonicalizeJson(result.outputContract));

    if (result.prompt.metadata.outputContractHash !== expectedOutputContractHash) {
      context.addIssue({
        code: 'custom',
        message: 'O output contract deve corresponder ao hash registrado pelo prompt.',
        path: ['outputContract'],
      });
    }
  });

export const agentRunStageSchema = z.enum(AGENT_RUN_STAGES);
export const agentRunErrorCodeSchema = z.enum(Object.values(AGENT_RUN_ERROR_CODES));
