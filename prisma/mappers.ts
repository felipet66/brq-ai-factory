import { artifactSchema } from '@brq/shared/schemas/artifact.schema';
import {
  agentExecutionSchema,
  executionSchema,
  projectSchema,
} from '@brq/shared/schemas/domain.schema';
import { logRecordSchema } from '@brq/shared/schemas/log-record.schema';
import { promptVersionSchema } from '@brq/shared/schemas/prompt-version.schema';
import type { Artifact } from '@brq/shared/types/artifact';
import type { AgentExecution, Execution, Project } from '@brq/shared/types/domain';
import type { LogRecord } from '@brq/shared/types/log-record';
import type { PromptVersion } from '@brq/shared/types/prompt-version';
import type {
  AgentExecution as AgentExecutionRecord,
  Artifact as ArtifactRecord,
  Execution as ExecutionRecord,
  Log as LogRecordModel,
  Project as ProjectRecord,
  PromptVersion as PromptVersionRecord,
} from '../generated/prisma/client';

function toIso(date: Date): string {
  return date.toISOString();
}

function toNullableIso(date: Date | null): string | null {
  return date === null ? null : toIso(date);
}

export function mapProject(record: ProjectRecord): Project {
  return projectSchema.parse({
    ...record,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  });
}

export function mapExecution(record: ExecutionRecord): Execution {
  return executionSchema.parse({
    ...record,
    createdAt: toIso(record.createdAt),
    startedAt: toNullableIso(record.startedAt),
    finishedAt: toNullableIso(record.finishedAt),
  });
}

export function mapAgentExecution(record: AgentExecutionRecord): AgentExecution {
  const usage =
    record.inputTokens === null && record.outputTokens === null
      ? null
      : {
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
        };

  return agentExecutionSchema.parse({
    id: record.id,
    executionId: record.executionId,
    agent: record.agent,
    status: record.status,
    attempt: record.attempt,
    input: record.input,
    output: record.output,
    agentVersion: record.agentVersion,
    promptVersion: record.promptVersion,
    schemaVersion: record.schemaVersion,
    model: record.model,
    usage,
    durationMs: record.durationMs,
    createdAt: toIso(record.createdAt),
    startedAt: toNullableIso(record.startedAt),
    finishedAt: toNullableIso(record.finishedAt),
  });
}

export function mapArtifact(record: ArtifactRecord): Artifact {
  return artifactSchema.parse({
    id: record.id,
    executionId: record.executionId,
    agentExecutionId: record.agentExecutionId,
    name: record.name,
    filename: record.filename,
    type: record.type,
    content: record.content,
    version: record.version,
    provenance: record.provenance,
    createdAt: toIso(record.createdAt),
  });
}

export function mapPromptVersion(record: PromptVersionRecord): PromptVersion {
  return promptVersionSchema.parse({
    ...record,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  });
}

export function mapLogRecord(record: LogRecordModel): LogRecord {
  return logRecordSchema.parse({
    ...record,
    createdAt: toIso(record.createdAt),
  });
}
