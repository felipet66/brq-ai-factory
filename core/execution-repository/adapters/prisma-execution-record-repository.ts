import type { ExecutionResult } from '@brq/execution-engine';
import type { ExecutionObservabilitySnapshot } from '@brq/observability';
import type { DatabaseClient } from '@brq/prisma/client';

import type {
  ExecutionRecord,
  ExecutionRecordCreatedInput,
  ExecutionRecordListQuery,
  ExecutionRecordPage,
  ExecutionRecordRepository,
  ExecutionRecordRunningInput,
} from '../contracts';
import { EXECUTION_REPOSITORY_ERROR_CODES, ExecutionRepositoryError } from '../errors';
import { immutableClone } from '../immutability';
import {
  createExecutionRecord,
  projectObservedExecutionRecord,
  projectRunningExecutionRecord,
  projectTerminalExecutionRecord,
} from '../mapper';
import {
  executionRecordCreatedInputSchema,
  executionRecordListQuerySchema,
  executionRecordRunningInputSchema,
  executionRecordSchema,
} from '../schemas';

interface RawLifecycle {
  sequence: number;
  event: string;
  state: string;
  occurredAt: Date;
  durationMs: number | null;
}

interface RawHashes {
  executionRequestHash: string | null;
  workflowRequestHash: string | null;
  workflowHash: string | null;
  lineageHash: string | null;
  provenanceHash: string | null;
  executionHash: string | null;
}

interface RawMetrics {
  stageId: string;
  durationMs: number | null;
  promptBytes: number | null;
  completionBytes: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  providerLatencyMs: number | null;
  validationDurationMs: number | null;
  artifactGenerationDurationMs: number | null;
}

interface RawObservedStage {
  ordinal: number;
  stageId: string;
  stageName: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  requestId: string | null;
  executionId: string;
  metrics: RawMetrics | null;
}

interface RawObservationEvent {
  sequence: number;
  type: string;
  stageId: string;
  stageName: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  requestId: string | null;
  executionId: string;
  errorCode: string | null;
}

interface RawObservation {
  observabilityVersion: string;
  revision: number;
  executionId: string;
  workflowId: string;
  requestId: string | null;
  status: string;
  updatedAt: Date;
  summaryWorkflowStatus: string | null;
  summaryReadinessFinal: string | null;
  summaryTotalDurationMs: number | null;
  summaryTotalTokens: number | null;
  summaryCostAmount: number | null;
  summaryCostCurrency: string | null;
  summaryRateCardVersion: string | null;
  stages: RawObservedStage[];
  events: RawObservationEvent[];
}

interface RawLineageOutput {
  productOwnerSpecificationHash: string | null;
  technicalSpecificationHash: string | null;
  qaSpecificationHash: string | null;
}

interface RawLineageHandoff {
  ordinal: number;
  fromStage: string;
  toStage: string;
  specification: string;
  calculatedHash: string;
  declaredHash: string;
  verified: boolean;
}

interface RawProvenanceStage {
  ordinal: number;
  stage: string;
  agent: string;
  executionId: string;
  agentExecutionId: string;
  agentVersion: string;
  outcome: string;
  readiness: string | null;
  assetBundleHash: string;
  knowledgeContextHash: string;
  promptHash: string;
  responseHash: string;
  validationHash: string;
  generationHash: string | null;
  artifactHashes: { ordinal: number; hash: string }[];
}

interface RawExecutionRecord {
  storageId: string;
  workflowId: string;
  executionId: string | null;
  requestId: string | null;
  traceId: string | null;
  projectName: string;
  status: string;
  workflowStatus: string | null;
  readiness: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  engineVersion: string;
  contractVersion: string;
  attempt: number;
  revision: number;
  failureKind: string | null;
  failureCode: string | null;
  failureSourceCode: string | null;
  hashes: RawHashes | null;
  lifecycleEvents: RawLifecycle[];
  observation: RawObservation | null;
  lineageOutput: RawLineageOutput | null;
  lineageHandoffs: RawLineageHandoff[];
  provenanceStages: RawProvenanceStage[];
}

const aggregateInclude = {
  hashes: true,
  lifecycleEvents: { orderBy: { sequence: 'asc' as const } },
  observation: {
    include: {
      events: { orderBy: { sequence: 'asc' as const } },
      stages: {
        orderBy: { ordinal: 'asc' as const },
        include: { metrics: true },
      },
    },
  },
  lineageOutput: true,
  lineageHandoffs: { orderBy: { ordinal: 'asc' as const } },
  provenanceStages: {
    orderBy: { ordinal: 'asc' as const },
    include: { artifactHashes: { orderBy: { ordinal: 'asc' as const } } },
  },
} as const;

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function mapHashes(raw: RawHashes | null) {
  return {
    executionRequestHash: raw?.executionRequestHash ?? null,
    workflowRequestHash: raw?.workflowRequestHash ?? null,
    workflowHash: raw?.workflowHash ?? null,
    lineageHash: raw?.lineageHash ?? null,
    provenanceHash: raw?.provenanceHash ?? null,
    executionHash: raw?.executionHash ?? null,
  };
}

function mapObservation(raw: RawExecutionRecord): unknown {
  const observation = raw.observation;
  if (observation === null) return null;
  const stages = observation.stages.map((stage) => ({
    stageId: stage.stageId,
    stageName: stage.stageName,
    status: stage.status,
    startedAt: iso(stage.startedAt),
    finishedAt: iso(stage.finishedAt),
    durationMs: stage.durationMs,
    requestId: stage.requestId,
    executionId: stage.executionId,
  }));
  const stageMetrics = observation.stages
    .filter((stage) => stage.metrics !== null)
    .map((stage) => ({
      stageId: stage.metrics!.stageId,
      durationMs: stage.metrics!.durationMs,
      promptBytes: stage.metrics!.promptBytes,
      completionBytes: stage.metrics!.completionBytes,
      inputTokens: stage.metrics!.inputTokens,
      outputTokens: stage.metrics!.outputTokens,
      totalTokens: stage.metrics!.totalTokens,
      providerLatencyMs: stage.metrics!.providerLatencyMs,
      validationDurationMs: stage.metrics!.validationDurationMs,
      artifactGenerationDurationMs: stage.metrics!.artifactGenerationDurationMs,
    }));
  const summary =
    observation.summaryWorkflowStatus === null
      ? null
      : {
          executionId: observation.executionId,
          workflowStatus: observation.summaryWorkflowStatus,
          readinessFinal: observation.summaryReadinessFinal,
          totalDurationMs: observation.summaryTotalDurationMs,
          totalTokens: observation.summaryTotalTokens,
          totalCostEstimate:
            observation.summaryCostAmount === null ||
            observation.summaryCostCurrency === null ||
            observation.summaryRateCardVersion === null
              ? null
              : {
                  amount: observation.summaryCostAmount,
                  currency: observation.summaryCostCurrency,
                  rateCardVersion: observation.summaryRateCardVersion,
                },
          executedStages: stages
            .filter((stage) => stage.status !== 'PENDING' && stage.status !== 'SKIPPED')
            .map((stage) => stage.stageId),
          skippedStages: stages
            .filter((stage) => stage.status === 'PENDING' || stage.status === 'SKIPPED')
            .map((stage) => stage.stageId),
          hashes: mapHashes(raw.hashes),
        };
  return {
    observabilityVersion: observation.observabilityVersion,
    revision: observation.revision,
    executionId: observation.executionId,
    workflowId: observation.workflowId,
    requestId: observation.requestId,
    status: observation.status,
    updatedAt: observation.updatedAt.toISOString(),
    events: observation.events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      stageId: event.stageId,
      stageName: event.stageName,
      status: event.status,
      startedAt: iso(event.startedAt),
      finishedAt: iso(event.finishedAt),
      durationMs: event.durationMs,
      requestId: event.requestId,
      executionId: event.executionId,
      errorCode: event.errorCode,
    })),
    stages,
    stageMetrics,
    summary,
  };
}

function mapRecord(value: unknown): ExecutionRecord {
  const raw = value as RawExecutionRecord;
  return immutableClone(
    executionRecordSchema.parse({
      storageId: raw.storageId,
      workflowId: raw.workflowId,
      executionId: raw.executionId,
      requestId: raw.requestId,
      traceId: raw.traceId,
      projectName: raw.projectName,
      status: raw.status,
      workflowStatus: raw.workflowStatus,
      readiness: raw.readiness,
      createdAt: raw.createdAt.toISOString(),
      startedAt: iso(raw.startedAt),
      finishedAt: iso(raw.finishedAt),
      durationMs: raw.durationMs,
      metadata: {
        engineVersion: raw.engineVersion,
        contractVersion: raw.contractVersion,
        attempt: raw.attempt,
      },
      hashes: mapHashes(raw.hashes),
      failure:
        raw.failureKind === null || raw.failureCode === null
          ? null
          : {
              kind: raw.failureKind,
              code: raw.failureCode,
              sourceCode: raw.failureSourceCode,
            },
      lineage:
        raw.lineageOutput === null
          ? null
          : {
              outputs: {
                productOwnerSpecificationHash: raw.lineageOutput.productOwnerSpecificationHash,
                technicalSpecificationHash: raw.lineageOutput.technicalSpecificationHash,
                qaSpecificationHash: raw.lineageOutput.qaSpecificationHash,
              },
              handoffs: raw.lineageHandoffs.map((handoff) => ({
                from: handoff.fromStage,
                to: handoff.toStage,
                specification: handoff.specification,
                calculatedHash: handoff.calculatedHash,
                declaredHash: handoff.declaredHash,
                verified: handoff.verified,
              })),
            },
      provenance:
        raw.provenanceStages.length === 0
          ? null
          : {
              stages: raw.provenanceStages.map((stage) => ({
                stage: stage.stage,
                agent: stage.agent,
                executionId: stage.executionId,
                agentExecutionId: stage.agentExecutionId,
                agentVersion: stage.agentVersion,
                outcome: stage.outcome,
                readiness: stage.readiness,
                assetBundleHash: stage.assetBundleHash,
                knowledgeContextHash: stage.knowledgeContextHash,
                promptHash: stage.promptHash,
                responseHash: stage.responseHash,
                validationHash: stage.validationHash,
                generationHash: stage.generationHash,
                artifactHashes: stage.artifactHashes.map((artifact) => artifact.hash),
              })),
            },
      observation: mapObservation(raw),
      lifecycle: raw.lifecycleEvents.map((event) => ({
        sequence: event.sequence,
        event: event.event,
        state: event.state,
        occurredAt: event.occurredAt.toISOString(),
        durationMs: event.durationMs,
      })),
      revision: raw.revision,
    }),
  );
}

function persistenceError(error: unknown): never {
  if (error instanceof ExecutionRepositoryError) throw error;
  const code =
    error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : null;
  if (code === 'P2002' || code === 'P2003') {
    throw new ExecutionRepositoryError('Conflito ao persistir o registro de execução.', {
      code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
      cause: error,
    });
  }
  if (code === 'P2025') {
    throw new ExecutionRepositoryError('Registro de execução não encontrado.', {
      code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
      cause: error,
    });
  }
  throw new ExecutionRepositoryError('Falha ao persistir o registro de execução.', {
    code: EXECUTION_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
    cause: error,
  });
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return persistenceError(error);
  }
}

function observationData(snapshot: ExecutionObservabilitySnapshot) {
  const summary = snapshot.summary;
  return {
    observabilityVersion: snapshot.observabilityVersion,
    revision: snapshot.revision,
    executionId: snapshot.executionId,
    workflowId: snapshot.workflowId,
    requestId: snapshot.requestId,
    status: snapshot.status,
    updatedAt: new Date(snapshot.updatedAt),
    summaryWorkflowStatus: summary?.workflowStatus ?? null,
    summaryReadinessFinal: summary?.readinessFinal ?? null,
    summaryTotalDurationMs: summary?.totalDurationMs ?? null,
    summaryTotalTokens: summary?.totalTokens ?? null,
    summaryCostAmount: summary?.totalCostEstimate?.amount ?? null,
    summaryCostCurrency: summary?.totalCostEstimate?.currency ?? null,
    summaryRateCardVersion: summary?.totalCostEstimate?.rateCardVersion ?? null,
  };
}

export class PrismaExecutionRecordRepository implements ExecutionRecordRepository {
  constructor(private readonly client: DatabaseClient) {}

  private async replaceObservation(
    client: DatabaseClient,
    storageId: string,
    snapshot: ExecutionObservabilitySnapshot,
  ): Promise<void> {
    await client.executionStageMetric.deleteMany({
      where: { executionObservedStage: { executionObservationId: storageId } },
    });
    await client.executionObservationEvent.deleteMany({
      where: { executionObservationId: storageId },
    });
    await client.executionObservedStage.deleteMany({
      where: { executionObservationId: storageId },
    });
    await client.executionObservation.upsert({
      where: { executionRecordId: storageId },
      create: {
        executionRecordId: storageId,
        ...observationData(snapshot),
      },
      update: observationData(snapshot),
    });
    for (const [index, stage] of snapshot.stages.entries()) {
      const metrics = snapshot.stageMetrics.find((entry) => entry.stageId === stage.stageId);
      await client.executionObservedStage.create({
        data: {
          executionObservationId: storageId,
          ordinal: index,
          stageId: stage.stageId,
          stageName: stage.stageName,
          status: stage.status,
          startedAt: stage.startedAt === null ? null : new Date(stage.startedAt),
          finishedAt: stage.finishedAt === null ? null : new Date(stage.finishedAt),
          durationMs: stage.durationMs,
          requestId: stage.requestId,
          executionId: stage.executionId,
          ...(metrics === undefined
            ? {}
            : {
                metrics: {
                  create: {
                    stageId: metrics.stageId,
                    durationMs: metrics.durationMs,
                    promptBytes: metrics.promptBytes,
                    completionBytes: metrics.completionBytes,
                    inputTokens: metrics.inputTokens,
                    outputTokens: metrics.outputTokens,
                    totalTokens: metrics.totalTokens,
                    providerLatencyMs: metrics.providerLatencyMs,
                    validationDurationMs: metrics.validationDurationMs,
                    artifactGenerationDurationMs: metrics.artifactGenerationDurationMs,
                  },
                },
              }),
        },
      });
    }
    if (snapshot.events.length > 0) {
      await client.executionObservationEvent.createMany({
        data: snapshot.events.map((event) => ({
          executionObservationId: storageId,
          sequence: event.sequence,
          type: event.type,
          stageId: event.stageId,
          stageName: event.stageName,
          status: event.status,
          startedAt: event.startedAt === null ? null : new Date(event.startedAt),
          finishedAt: event.finishedAt === null ? null : new Date(event.finishedAt),
          durationMs: event.durationMs,
          requestId: event.requestId,
          executionId: event.executionId,
          errorCode: event.errorCode,
        })),
      });
    }
  }

  async create(input: ExecutionRecordCreatedInput): Promise<ExecutionRecord> {
    const parsed = executionRecordCreatedInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Entrada de criação do registro inválida.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    return run(async () => {
      const skeleton = createExecutionRecord('pending-storage-id', parsed.data);
      const record = await this.client.executionRecord.create({
        data: {
          workflowId: skeleton.workflowId,
          requestId: skeleton.requestId,
          traceId: skeleton.traceId,
          projectName: skeleton.projectName,
          status: skeleton.status,
          createdAt: new Date(skeleton.createdAt),
          engineVersion: skeleton.metadata.engineVersion,
          contractVersion: skeleton.metadata.contractVersion,
          attempt: skeleton.metadata.attempt,
          hashes: { create: { ...skeleton.hashes } },
          lifecycleEvents: {
            create: skeleton.lifecycle.map((event) => ({
              sequence: event.sequence,
              event: event.event,
              state: event.state,
              occurredAt: new Date(event.occurredAt),
              durationMs: event.durationMs,
            })),
          },
        },
        include: aggregateInclude,
      });
      return mapRecord(record);
    });
  }

  async markRunning(input: ExecutionRecordRunningInput): Promise<ExecutionRecord> {
    const parsed = executionRecordRunningInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Entrada de execução em andamento inválida.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    return run(async () => {
      const current = await this.client.executionRecord.findUnique({
        where: { workflowId: parsed.data.workflowId },
        include: aggregateInclude,
      });
      if (current === null) {
        throw new ExecutionRepositoryError('Registro de execução não encontrado.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      const projected = projectRunningExecutionRecord(mapRecord(current), parsed.data.startedAt);
      const event = projected.lifecycle.at(-1)!;
      const updated = await this.client.executionRecord.update({
        where: { workflowId: projected.workflowId, status: 'CREATED' },
        data: {
          status: projected.status,
          startedAt: new Date(projected.startedAt!),
          revision: { increment: 1 },
          lifecycleEvents: {
            create: {
              sequence: event.sequence,
              event: event.event,
              state: event.state,
              occurredAt: new Date(event.occurredAt),
              durationMs: event.durationMs,
            },
          },
        },
        include: aggregateInclude,
      });
      return mapRecord(updated);
    });
  }

  async saveObservation(
    workflowId: string,
    snapshot: ExecutionObservabilitySnapshot,
  ): Promise<ExecutionRecord> {
    return run(async () => {
      const record = await this.client.executionRecord.findUnique({
        where: { workflowId },
        include: aggregateInclude,
      });
      if (record === null) {
        throw new ExecutionRepositoryError('Registro de execução não encontrado.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      const current = mapRecord(record);
      if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(current.status)) return current;
      const projected = projectObservedExecutionRecord(current, snapshot);
      await this.client.$transaction(async (transaction) => {
        await transaction.executionRecord.update({
          where: { storageId: current.storageId },
          data: {
            executionId: projected.executionId,
            revision: { increment: 1 },
            ...(snapshot.summary === null
              ? {}
              : {
                  hashes: {
                    upsert: {
                      create: { ...snapshot.summary.hashes },
                      update: { ...snapshot.summary.hashes },
                    },
                  },
                }),
          },
        });
        await this.replaceObservation(
          transaction as unknown as DatabaseClient,
          current.storageId,
          snapshot,
        );
      });
      return (await this.findByWorkflowId(workflowId))!;
    });
  }

  async complete(
    workflowId: string,
    result: ExecutionResult,
    snapshot: ExecutionObservabilitySnapshot | null,
  ): Promise<ExecutionRecord> {
    return run(async () => {
      const record = await this.client.executionRecord.findUnique({
        where: { workflowId },
        include: aggregateInclude,
      });
      if (record === null) {
        throw new ExecutionRepositoryError('Registro de execução não encontrado.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      const current = mapRecord(record);
      if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(current.status)) {
        if (
          current.executionId === result.executionId &&
          current.hashes.executionHash === result.hashes.executionHash
        ) {
          return current;
        }
        throw new ExecutionRepositoryError('Resultado terminal divergente.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
        });
      }
      const projected = projectTerminalExecutionRecord(current, result, snapshot);
      const terminalEvent = projected.lifecycle.at(-1)!;

      await this.client.$transaction(async (transaction) => {
        await transaction.executionProvenanceArtifactHash.deleteMany({
          where: { executionProvenanceStage: { executionRecordId: current.storageId } },
        });
        await transaction.executionProvenanceStage.deleteMany({
          where: { executionRecordId: current.storageId },
        });
        await transaction.executionLineageHandoff.deleteMany({
          where: { executionRecordId: current.storageId },
        });
        await transaction.executionLineageOutput.deleteMany({
          where: { executionRecordId: current.storageId },
        });
        await transaction.executionRecord.update({
          where: { storageId: current.storageId },
          data: {
            executionId: projected.executionId,
            status: projected.status,
            workflowStatus: projected.workflowStatus,
            readiness: projected.readiness,
            startedAt: projected.startedAt === null ? null : new Date(projected.startedAt),
            finishedAt: new Date(projected.finishedAt!),
            durationMs: projected.durationMs,
            engineVersion: projected.metadata.engineVersion,
            contractVersion: projected.metadata.contractVersion,
            attempt: projected.metadata.attempt,
            revision: { increment: 1 },
            failureKind: projected.failure?.kind ?? null,
            failureCode: projected.failure?.code ?? null,
            failureSourceCode: projected.failure?.sourceCode ?? null,
            hashes: {
              upsert: {
                create: { ...projected.hashes },
                update: { ...projected.hashes },
              },
            },
            lifecycleEvents: {
              create: {
                sequence: terminalEvent.sequence,
                event: terminalEvent.event,
                state: terminalEvent.state,
                occurredAt: new Date(terminalEvent.occurredAt),
                durationMs: terminalEvent.durationMs,
              },
            },
            ...(projected.lineage === null
              ? {}
              : {
                  lineageOutput: { create: { ...projected.lineage.outputs } },
                  lineageHandoffs: {
                    create: projected.lineage.handoffs.map((handoff, ordinal) => ({
                      ordinal,
                      fromStage: handoff.from,
                      toStage: handoff.to,
                      specification: handoff.specification,
                      calculatedHash: handoff.calculatedHash,
                      declaredHash: handoff.declaredHash,
                      verified: handoff.verified,
                    })),
                  },
                }),
            ...(projected.provenance === null
              ? {}
              : {
                  provenanceStages: {
                    create: projected.provenance.stages.map((stage, ordinal) => ({
                      ordinal,
                      stage: stage.stage,
                      agent: stage.agent,
                      executionId: stage.executionId,
                      agentExecutionId: stage.agentExecutionId,
                      agentVersion: stage.agentVersion,
                      outcome: stage.outcome,
                      readiness: stage.readiness,
                      assetBundleHash: stage.assetBundleHash,
                      knowledgeContextHash: stage.knowledgeContextHash,
                      promptHash: stage.promptHash,
                      responseHash: stage.responseHash,
                      validationHash: stage.validationHash,
                      generationHash: stage.generationHash,
                      artifactHashes: {
                        create: stage.artifactHashes.map((hash, artifactOrdinal) => ({
                          ordinal: artifactOrdinal,
                          hash,
                        })),
                      },
                    })),
                  },
                }),
          },
        });
        if (snapshot !== null) {
          await this.replaceObservation(
            transaction as unknown as DatabaseClient,
            current.storageId,
            snapshot,
          );
        }
      });
      return (await this.findByWorkflowId(workflowId))!;
    });
  }

  async findByExecutionId(executionId: string): Promise<ExecutionRecord | null> {
    return run(async () => {
      const record = await this.client.executionRecord.findUnique({
        where: { executionId },
        include: aggregateInclude,
      });
      return record === null ? null : mapRecord(record);
    });
  }

  async findByWorkflowId(workflowId: string): Promise<ExecutionRecord | null> {
    return run(async () => {
      const record = await this.client.executionRecord.findUnique({
        where: { workflowId },
        include: aggregateInclude,
      });
      return record === null ? null : mapRecord(record);
    });
  }

  async list(rawQuery: ExecutionRecordListQuery = {}): Promise<ExecutionRecordPage> {
    const parsed = executionRecordListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Filtros de execução inválidos.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    const query = parsed.data;
    return run(async () => {
      const records = await this.client.executionRecord.findMany({
        where: {
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.readiness === undefined ? {} : { readiness: query.readiness }),
          ...(query.createdAfter === undefined && query.createdBefore === undefined
            ? {}
            : {
                createdAt: {
                  ...(query.createdAfter === undefined
                    ? {}
                    : { gte: new Date(query.createdAfter) }),
                  ...(query.createdBefore === undefined
                    ? {}
                    : { lte: new Date(query.createdBefore) }),
                },
              }),
        },
        orderBy: [{ createdAt: 'desc' }, { workflowId: 'desc' }],
        ...(query.cursor === undefined ? {} : { cursor: { workflowId: query.cursor }, skip: 1 }),
        take: query.limit + 1,
        include: aggregateInclude,
      });
      const hasMore = records.length > query.limit;
      const page = records.slice(0, query.limit).map(mapRecord);
      return immutableClone({
        items: page,
        nextCursor: hasMore ? page.at(-1)!.workflowId : null,
      });
    });
  }
}
