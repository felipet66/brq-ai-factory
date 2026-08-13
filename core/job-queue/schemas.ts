import { executionRequestSchema } from '@brq/execution-engine';
import { isoDateTimeSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

export const jobIdSchema = z.string().regex(/^job-[a-f0-9]{32}$/);
export const jobExecutionIdSchema = z.string().regex(/^execution-[a-f0-9]{32}$/);

export const jobExecutionOptionsSchema = z
  .object({
    cacheMode: z.enum(['READ_WRITE', 'REQUIRE_HIT']),
    sourceExecutionId: jobExecutionIdSchema.nullable(),
  })
  .strict()
  .superRefine((options, context) => {
    if (
      (options.cacheMode === 'REQUIRE_HIT' && options.sourceExecutionId === null) ||
      (options.cacheMode === 'READ_WRITE' && options.sourceExecutionId !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceExecutionId'],
        message: 'A execução de origem deve existir somente no modo REQUIRE_HIT.',
      });
    }
  });

const defaultJobExecutionOptions = Object.freeze({
  cacheMode: 'READ_WRITE' as const,
  sourceExecutionId: null,
});

export const jobStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED']);

export const queueEventTypeSchema = z.enum([
  'job.created',
  'job.started',
  'job.finished',
  'job.failed',
  'job.cancelled',
]);

export const jobFailureSchema = z
  .object({
    code: z.string().trim().min(1).max(128),
    message: z.string().trim().min(1).max(300),
  })
  .strict();

export const queueEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    type: queueEventTypeSchema,
    jobId: jobIdSchema,
    executionId: jobExecutionIdSchema,
    workflowId: executionRequestSchema.shape.workflowId,
    status: jobStatusSchema,
    occurredAt: isoDateTimeSchema,
    durationMs: z.number().int().nonnegative().nullable(),
    errorCode: z.string().trim().min(1).max(128).nullable(),
  })
  .strict()
  .superRefine((event, context) => {
    const expectedStatus: Record<
      z.infer<typeof queueEventTypeSchema>,
      z.infer<typeof jobStatusSchema>
    > = {
      'job.created': 'QUEUED',
      'job.started': 'RUNNING',
      'job.finished': 'SUCCESS',
      'job.failed': 'FAILED',
      'job.cancelled': 'CANCELLED',
    };
    if (event.status !== expectedStatus[event.type]) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'O status deve corresponder ao tipo do evento.',
      });
    }
    const terminal = ['job.finished', 'job.failed', 'job.cancelled'].includes(event.type);
    if ((terminal && event.durationMs === null) || (!terminal && event.durationMs !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: 'A duração deve existir somente em eventos terminais.',
      });
    }
    const failure = event.type === 'job.failed' || event.type === 'job.cancelled';
    if ((failure && event.errorCode === null) || (!failure && event.errorCode !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['errorCode'],
        message: 'O código de erro deve existir somente em falha ou cancelamento.',
      });
    }
  });

const nullableDateTimeSchema = isoDateTimeSchema.nullable();

export const jobRecordSchema = z
  .object({
    jobId: jobIdSchema,
    executionId: jobExecutionIdSchema,
    workflowId: executionRequestSchema.shape.workflowId,
    status: jobStatusSchema,
    attempt: z.literal(1),
    queuedAt: isoDateTimeSchema,
    startedAt: nullableDateTimeSchema,
    finishedAt: nullableDateTimeSchema,
    durationMs: z.number().int().nonnegative().nullable(),
    failure: jobFailureSchema.nullable(),
    events: z.array(queueEventSchema).min(1).max(3),
  })
  .strict()
  .superRefine((job, context) => {
    job.events.forEach((event, index) => {
      if (event.sequence !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'sequence'],
          message: 'Os eventos do job devem possuir sequência contígua.',
        });
      }
      if (
        event.jobId !== job.jobId ||
        event.executionId !== job.executionId ||
        event.workflowId !== job.workflowId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['events', index],
          message: 'O evento deve pertencer ao job informado.',
        });
      }
      if (
        index > 0 &&
        Date.parse(event.occurredAt) < Date.parse(job.events[index - 1]!.occurredAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'occurredAt'],
          message: 'Os eventos do job devem ser monotônicos.',
        });
      }
    });

    if (job.events.at(-1)?.status !== job.status) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'O último evento deve representar o status atual do job.',
      });
    }

    const eventTypes = job.events.map((event) => event.type).join(',');
    const allowedSequence =
      (job.status === 'QUEUED' && eventTypes === 'job.created') ||
      (job.status === 'RUNNING' && eventTypes === 'job.created,job.started') ||
      (job.status === 'SUCCESS' && eventTypes === 'job.created,job.started,job.finished') ||
      (job.status === 'FAILED' && eventTypes === 'job.created,job.started,job.failed') ||
      (job.status === 'CANCELLED' &&
        (eventTypes === 'job.created,job.cancelled' ||
          eventTypes === 'job.created,job.started,job.cancelled'));
    if (!allowedSequence) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'A sequência de eventos deve corresponder ao lifecycle do job.',
      });
    }

    const started = job.startedAt !== null;
    const finished = job.finishedAt !== null;
    if (started && Date.parse(job.startedAt!) < Date.parse(job.queuedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['startedAt'],
        message: 'startedAt não pode ser anterior a queuedAt.',
      });
    }
    if (finished && Date.parse(job.finishedAt!) < Date.parse(job.startedAt ?? job.queuedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'finishedAt não pode ser anterior ao início do job.',
      });
    }

    if (job.status === 'QUEUED') {
      if (started || finished || job.durationMs !== null || job.failure !== null) {
        context.addIssue({
          code: 'custom',
          path: ['status'],
          message: 'Um job QUEUED não pode conter metadados de execução ou término.',
        });
      }
    } else if (job.status === 'RUNNING') {
      if (!started || finished || job.durationMs !== null || job.failure !== null) {
        context.addIssue({
          code: 'custom',
          path: ['status'],
          message: 'Um job RUNNING exige início e não pode conter metadados terminais.',
        });
      }
    } else {
      if (!finished || job.durationMs === null) {
        context.addIssue({
          code: 'custom',
          path: ['status'],
          message: 'Um job terminal exige finishedAt e durationMs.',
        });
      }
      const expectsFailure = job.status === 'FAILED' || job.status === 'CANCELLED';
      if ((expectsFailure && job.failure === null) || (!expectsFailure && job.failure !== null)) {
        context.addIssue({
          code: 'custom',
          path: ['failure'],
          message: 'A falha deve corresponder ao status terminal do job.',
        });
      }
    }
  });

export const enqueueJobInputSchema = z
  .object({
    jobId: jobIdSchema,
    executionId: jobExecutionIdSchema,
    request: executionRequestSchema,
    executionOptions: jobExecutionOptionsSchema.default(defaultJobExecutionOptions),
  })
  .strict();

export const claimedJobSchema = z
  .object({
    record: jobRecordSchema,
    request: executionRequestSchema,
    executionOptions: jobExecutionOptionsSchema.default(defaultJobExecutionOptions),
  })
  .strict()
  .superRefine((claimed, context) => {
    if (claimed.record.status !== 'RUNNING') {
      context.addIssue({
        code: 'custom',
        path: ['record', 'status'],
        message: 'Um job consumido deve estar RUNNING.',
      });
    }
    if (claimed.record.workflowId !== claimed.request.workflowId) {
      context.addIssue({
        code: 'custom',
        path: ['request', 'workflowId'],
        message: 'ExecutionRequest deve pertencer ao workflow do job.',
      });
    }
  });

export const queueMetricsSchema = z
  .object({
    totalJobs: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    retainedPayloads: z.number().int().nonnegative(),
    acceptingJobs: z.boolean(),
  })
  .strict()
  .superRefine((metrics, context) => {
    if (
      metrics.totalJobs !==
      metrics.queued + metrics.running + metrics.success + metrics.failed + metrics.cancelled
    ) {
      context.addIssue({
        code: 'custom',
        path: ['totalJobs'],
        message: 'totalJobs deve corresponder à soma dos estados.',
      });
    }
    if (metrics.retainedPayloads > metrics.queued + metrics.running) {
      context.addIssue({
        code: 'custom',
        path: ['retainedPayloads'],
        message: 'Payloads só podem permanecer em jobs ativos.',
      });
    }
  });
