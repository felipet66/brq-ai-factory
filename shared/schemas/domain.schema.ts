import { z } from 'zod';

import {
  AGENT_EXECUTION_STATUSES,
  EXECUTION_STATUSES,
  PROJECT_STATUSES,
} from '../constants/statuses';
import { baseAgentInputSchema, baseAgentOutputSchema } from './agent-contracts.schema';
import {
  agentNameSchema,
  identifierSchema,
  isoDateTimeSchema,
  semanticVersionSchema,
} from './common.schema';
import { jsonValueSchema } from './json-value.schema';

export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export const executionStatusSchema = z.enum(EXECUTION_STATUSES);
export const agentExecutionStatusSchema = z.enum(AGENT_EXECUTION_STATUSES);

export const tokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  })
  .strict();

function addDateIssue(
  context: z.core.$RefinementCtx,
  field: 'startedAt' | 'finishedAt',
  message: string,
): void {
  context.addIssue({
    code: 'custom',
    path: [field],
    message,
  });
}

function validateDateOrder(
  value: { startedAt: string | null; finishedAt: string | null },
  context: z.core.$RefinementCtx,
): void {
  if (
    value.startedAt !== null &&
    value.finishedAt !== null &&
    Date.parse(value.finishedAt) < Date.parse(value.startedAt)
  ) {
    addDateIssue(context, 'finishedAt', 'finishedAt não pode ser anterior a startedAt.');
  }
}

export const projectSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(5_000),
    status: projectStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const projectCreateInputSchema = projectSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const executionBaseSchema = z
  .object({
    id: identifierSchema,
    projectId: identifierSchema,
    status: executionStatusSchema,
    createdAt: isoDateTimeSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

function validateExecutionDates(
  execution: {
    status: z.infer<typeof executionStatusSchema>;
    startedAt: string | null;
    finishedAt: string | null;
  },
  context: z.core.$RefinementCtx,
): void {
  if (execution.status === 'CREATED') {
    if (execution.startedAt !== null) {
      addDateIssue(context, 'startedAt', 'CREATED exige startedAt nulo.');
    }

    if (execution.finishedAt !== null) {
      addDateIssue(context, 'finishedAt', 'CREATED exige finishedAt nulo.');
    }
  }

  if (execution.status === 'RUNNING' || execution.status === 'REQUIRES_REVIEW') {
    if (execution.startedAt === null) {
      addDateIssue(context, 'startedAt', `${execution.status} exige startedAt preenchido.`);
    }

    if (execution.finishedAt !== null) {
      addDateIssue(context, 'finishedAt', `${execution.status} exige finishedAt nulo.`);
    }
  }

  if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(execution.status)) {
    if (execution.finishedAt === null) {
      addDateIssue(context, 'finishedAt', `${execution.status} exige finishedAt preenchido.`);
    }

    if (execution.status !== 'CANCELLED' && execution.startedAt === null) {
      addDateIssue(context, 'startedAt', `${execution.status} exige startedAt preenchido.`);
    }
  }

  validateDateOrder(execution, context);
}

export const executionCreateInputSchema = executionBaseSchema
  .omit({
    id: true,
    createdAt: true,
  })
  .superRefine(validateExecutionDates);

export const executionSchema = executionBaseSchema.superRefine(validateExecutionDates);

const agentExecutionBaseSchema = z
  .object({
    id: identifierSchema,
    executionId: identifierSchema,
    agent: agentNameSchema,
    status: agentExecutionStatusSchema,
    attempt: z.number().int().positive(),
    input: baseAgentInputSchema,
    output: baseAgentOutputSchema.catchall(jsonValueSchema).nullable(),
    agentVersion: semanticVersionSchema,
    promptVersion: semanticVersionSchema,
    schemaVersion: semanticVersionSchema,
    model: z.string().trim().min(1).nullable(),
    usage: tokenUsageSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    createdAt: isoDateTimeSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

function validateAgentExecutionDates(
  agentExecution: {
    status: z.infer<typeof agentExecutionStatusSchema>;
    startedAt: string | null;
    finishedAt: string | null;
  },
  context: z.core.$RefinementCtx,
): void {
  if (agentExecution.status === 'CREATED') {
    if (agentExecution.startedAt !== null) {
      addDateIssue(context, 'startedAt', 'CREATED exige startedAt nulo.');
    }

    if (agentExecution.finishedAt !== null) {
      addDateIssue(context, 'finishedAt', 'CREATED exige finishedAt nulo.');
    }
  }

  if (agentExecution.status === 'RUNNING') {
    if (agentExecution.startedAt === null) {
      addDateIssue(context, 'startedAt', 'RUNNING exige startedAt preenchido.');
    }

    if (agentExecution.finishedAt !== null) {
      addDateIssue(context, 'finishedAt', 'RUNNING exige finishedAt nulo.');
    }
  }

  if (
    ['SUCCESS', 'PARTIAL_SUCCESS', 'REQUIRES_REVIEW', 'FAILED', 'CANCELLED'].includes(
      agentExecution.status,
    )
  ) {
    if (agentExecution.finishedAt === null) {
      addDateIssue(context, 'finishedAt', `${agentExecution.status} exige finishedAt preenchido.`);
    }

    if (agentExecution.status !== 'CANCELLED' && agentExecution.startedAt === null) {
      addDateIssue(context, 'startedAt', `${agentExecution.status} exige startedAt preenchido.`);
    }
  }

  validateDateOrder(agentExecution, context);
}

export const agentExecutionCreateInputSchema = agentExecutionBaseSchema
  .omit({
    id: true,
    createdAt: true,
  })
  .superRefine(validateAgentExecutionDates);

export const agentExecutionSchema = agentExecutionBaseSchema.superRefine(
  validateAgentExecutionDates,
);
