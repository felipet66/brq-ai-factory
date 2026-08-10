import { approvedPreviewArtifactDescriptorSchema } from '@brq/preview-artifact';
import {
  identifierSchema,
  isoDateTimeSchema,
  semanticVersionSchema,
} from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

import {
  previewEffectiveLimitsSchema,
  previewLimitReductionsSchema,
  resolvePreviewLimits,
} from './configuration';
import { PREVIEW_RUNNER_ERROR_CODES, PREVIEW_RUNNER_ERROR_STAGES } from './errors';
import {
  calculatePreviewLineageHash,
  calculatePreviewLimitsHash,
  calculatePreviewPolicyHash,
  calculatePreviewProvenanceHash,
  calculatePreviewRequestHash,
  calculatePreviewRuntimeHash,
  calculatePreviewSessionHash,
  derivePreviewId,
} from './hashing';
import {
  PREVIEW_HEALTH_STATUSES,
  PREVIEW_OBSERVABILITY_EVENTS,
  PREVIEW_SESSION_STATUSES,
  PREVIEW_STOP_REASONS,
} from './lifecycle';
import { NODE_WEB_PREVIEW_24_V1_POLICY, previewPolicySchema } from './policies';
import {
  PREVIEW_OBSERVABILITY_CONTRACT_VERSION,
  PREVIEW_RUNNER_CONTRACT_VERSION,
  PREVIEW_RUNNER_HASH_ALGORITHM,
  PREVIEW_RUNNER_VERSION,
} from './version';

const HASH = /^[a-f0-9]{64}$/u;
const PREFIXED_HASH = /^sha256:[a-f0-9]{64}$/u;
const SAFE_TECHNICAL_NAME = /^[A-Z][A-Z0-9_]{1,63}$/u;

export const previewHashSchema = z.string().regex(HASH);
export const previewIdSchema = z.string().regex(/^preview-[a-f0-9]{32}$/u);
export const previewSessionStatusSchema = z.enum(PREVIEW_SESSION_STATUSES);
export const previewHealthStatusSchema = z.enum(PREVIEW_HEALTH_STATUSES);
export const previewStopReasonSchema = z.enum(PREVIEW_STOP_REASONS);
export const previewObservabilityEventNameSchema = z.enum(PREVIEW_OBSERVABILITY_EVENTS);

export const previewStartRequestSchema = z
  .object({
    executionId: identifierSchema,
    artifact: approvedPreviewArtifactDescriptorSchema,
    policyId: z.literal('NODE_WEB_PREVIEW_24_V1'),
    limits: previewLimitReductionsSchema.optional(),
    requestId: identifierSchema.optional(),
    traceId: identifierSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.executionId !== request.artifact.source.executionId) {
      context.addIssue({
        code: 'custom',
        path: ['executionId'],
        message: 'A execução deve corresponder ao artifact aprovado.',
      });
    }
  });

export const previewRuntimeObservationSchema = z
  .object({
    adapter: z.string().regex(SAFE_TECHNICAL_NAME),
    engineName: z.string().trim().min(1).max(64),
    engineVersion: z.string().trim().min(1).max(64),
    imageReference: z.string().trim().min(1).max(300),
    imageDigest: z.string().regex(PREFIXED_HASH),
    imageId: z.string().regex(PREFIXED_HASH),
    platform: z.string().trim().min(1).max(64),
    runtimeName: z.literal('NODE'),
    runtimeVersion: z.literal('24.19.0'),
    serverAbiVersion: semanticVersionSchema,
  })
  .strict();

export const previewLineageSchema = z
  .object({
    executionId: identifierSchema,
    artifactId: z.string().regex(/^preview-artifact-[a-f0-9]{32}$/u),
    factoryResultHash: previewHashSchema,
    sandboxRequestHash: previewHashSchema,
    sandboxResultHash: previewHashSchema,
    workspaceHash: previewHashSchema,
    artifactHash: previewHashSchema,
    artifactApprovalHash: previewHashSchema,
  })
  .strict();

export const previewProvenanceSchema = z
  .object({
    runnerVersion: z.literal(PREVIEW_RUNNER_VERSION),
    contractVersion: z.literal(PREVIEW_RUNNER_CONTRACT_VERSION),
    hashAlgorithm: z.literal(PREVIEW_RUNNER_HASH_ALGORITHM),
    artifactVersion: semanticVersionSchema,
    artifactContractVersion: semanticVersionSchema,
    exporterVersion: semanticVersionSchema,
    policyId: z.literal('NODE_WEB_PREVIEW_24_V1'),
    policyVersion: semanticVersionSchema,
    policyHash: previewHashSchema,
    limitsHash: previewHashSchema,
    runtime: previewRuntimeObservationSchema.nullable(),
  })
  .strict();

export const previewHashesSchema = z
  .object({
    factoryResultHash: previewHashSchema,
    sandboxRequestHash: previewHashSchema,
    sandboxResultHash: previewHashSchema,
    workspaceHash: previewHashSchema,
    artifactHash: previewHashSchema,
    artifactApprovalHash: previewHashSchema,
    policyHash: previewHashSchema,
    limitsHash: previewHashSchema,
    previewRequestHash: previewHashSchema,
    lineageHash: previewHashSchema,
    provenanceHash: previewHashSchema,
    previewSessionHash: previewHashSchema,
  })
  .strict();

export const previewFailureSchema = z
  .object({
    code: z.enum(Object.values(PREVIEW_RUNNER_ERROR_CODES)),
    stage: z.enum(Object.values(PREVIEW_RUNNER_ERROR_STAGES)),
    sourceCode: z.string().trim().min(1).max(128).nullable(),
    message: z.string().trim().min(1).max(300),
  })
  .strict();

export const approvedPreviewStartRequestSchema = z
  .object({
    previewId: previewIdSchema,
    executionId: identifierSchema,
    artifact: approvedPreviewArtifactDescriptorSchema,
    policy: previewPolicySchema,
    effectiveLimits: previewEffectiveLimitsSchema,
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    hashes: previewHashesSchema,
    requestId: identifierSchema.optional(),
    traceId: identifierSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.executionId !== request.artifact.source.executionId) {
      context.addIssue({
        code: 'custom',
        path: ['executionId'],
        message: 'ExecutionId divergente.',
      });
      return;
    }
    if (
      request.policy.artifactProfileId !== request.artifact.metadata.profileId ||
      request.policy.policyId !== request.artifact.metadata.profileId
    ) {
      context.addIssue({ code: 'custom', path: ['policy'], message: 'Profile incompatível.' });
    }
    const policyHash = calculatePreviewPolicyHash(request.policy);
    const limitsHash = calculatePreviewLimitsHash(request.effectiveLimits);
    const canonicalPolicyHash = calculatePreviewPolicyHash(NODE_WEB_PREVIEW_24_V1_POLICY);
    const canonicalEffectiveLimits = resolvePreviewLimits(NODE_WEB_PREVIEW_24_V1_POLICY.limits, {
      ttlSeconds: request.effectiveLimits.ttlSeconds,
      responseBytes: request.effectiveLimits.responseBytes,
      responseTimeoutMs: request.effectiveLimits.responseTimeoutMs,
    });
    const canonicalLimitsHash = calculatePreviewLimitsHash(canonicalEffectiveLimits);
    const previewRequestHash = calculatePreviewRequestHash({
      executionId: request.executionId,
      artifact: request.artifact,
      policyId: request.policy.policyId,
      policyHash,
      effectiveLimits: request.effectiveLimits,
    });
    const lineage = {
      executionId: request.executionId,
      artifactId: request.artifact.artifactId,
      factoryResultHash: request.artifact.approval!.factoryResultHash,
      sandboxRequestHash: request.artifact.source.sandboxRequestHash,
      sandboxResultHash: request.artifact.approval!.sandboxResultHash,
      workspaceHash: request.artifact.source.workspaceHash,
      artifactHash: request.artifact.hashes.artifactHash,
      artifactApprovalHash: request.artifact.hashes.approvalHash!,
    };
    const lineageHash = calculatePreviewLineageHash(lineage);
    const provenanceHash = calculatePreviewProvenanceHash({
      runnerVersion: PREVIEW_RUNNER_VERSION,
      contractVersion: PREVIEW_RUNNER_CONTRACT_VERSION,
      hashAlgorithm: PREVIEW_RUNNER_HASH_ALGORITHM,
      artifactVersion: request.artifact.metadata.artifactVersion,
      artifactContractVersion: request.artifact.metadata.contractVersion,
      exporterVersion: request.artifact.metadata.exporterVersion,
      policyId: request.policy.policyId,
      policyVersion: request.policy.version,
      policyHash,
      limitsHash,
      runtime: null,
    });
    const previewId = derivePreviewId(previewRequestHash);
    const previewSessionHash = calculatePreviewSessionHash({
      previewId,
      executionId: request.executionId,
      artifactId: request.artifact.artifactId,
      previewRequestHash,
      policyHash,
      limitsHash,
      lineageHash,
    });
    const expectedExpiresAt = new Date(
      Math.min(
        Date.parse(request.createdAt) + request.effectiveLimits.ttlSeconds * 1000,
        Date.parse(request.artifact.expiresAt),
      ),
    ).toISOString();
    if (
      policyHash !== canonicalPolicyHash ||
      limitsHash !== canonicalLimitsHash ||
      request.expiresAt !== expectedExpiresAt ||
      Date.parse(request.createdAt) < Date.parse(request.artifact.approval!.approvedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['policy'],
        message: 'Policy, limites ou janela temporal não correspondem à resolução canônica.',
      });
    }
    if (
      request.hashes.factoryResultHash !== lineage.factoryResultHash ||
      request.hashes.sandboxRequestHash !== lineage.sandboxRequestHash ||
      request.hashes.sandboxResultHash !== lineage.sandboxResultHash ||
      request.hashes.workspaceHash !== lineage.workspaceHash ||
      request.hashes.artifactHash !== lineage.artifactHash ||
      request.hashes.artifactApprovalHash !== lineage.artifactApprovalHash ||
      request.hashes.policyHash !== policyHash ||
      request.hashes.limitsHash !== limitsHash ||
      request.hashes.previewRequestHash !== previewRequestHash ||
      request.hashes.lineageHash !== lineageHash ||
      request.hashes.provenanceHash !== provenanceHash ||
      request.hashes.previewSessionHash !== previewSessionHash ||
      request.previewId !== previewId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['hashes'],
        message: 'Hashes do start request inválidos.',
      });
    }
  });

export const previewRuntimeResultSchema = z
  .object({
    previewId: previewIdSchema,
    executionId: identifierSchema,
    status: z.literal('RUNNING'),
    health: z.object({ status: z.literal('HEALTHY'), observedAt: isoDateTimeSchema }).strict(),
    startedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    runtime: previewRuntimeObservationSchema,
    runtimeHash: previewHashSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.runtimeHash !== calculatePreviewRuntimeHash(result.runtime)) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeHash'],
        message: 'Runtime hash inválido.',
      });
    }
    if (Date.parse(result.expiresAt) <= Date.parse(result.startedAt)) {
      context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Expiração inválida.' });
    }
  });

export const previewInspectRequestSchema = z
  .object({ previewId: previewIdSchema, executionId: identifierSchema })
  .strict();

export const previewRuntimeInspectionSchema = z
  .object({
    previewId: previewIdSchema,
    executionId: identifierSchema,
    status: z.enum(['RUNNING', 'MISSING', 'UNHEALTHY']),
    health: previewHealthStatusSchema,
    observedAt: isoDateTimeSchema,
    runtime: previewRuntimeObservationSchema.nullable(),
  })
  .strict()
  .superRefine((inspection, context) => {
    if (
      (inspection.status === 'RUNNING' &&
        (inspection.health !== 'HEALTHY' || inspection.runtime === null)) ||
      (inspection.status === 'MISSING' &&
        (inspection.health !== 'NOT_APPLICABLE' || inspection.runtime !== null)) ||
      (inspection.status === 'UNHEALTHY' && inspection.health !== 'UNHEALTHY')
    ) {
      context.addIssue({ code: 'custom', message: 'Runtime inspection inconsistente.' });
    }
  });

export const previewStopRequestSchema = z
  .object({
    previewId: previewIdSchema,
    executionId: identifierSchema,
    reason: previewStopReasonSchema,
  })
  .strict();

export const previewStopResultSchema = z
  .object({
    previewId: previewIdSchema,
    executionId: identifierSchema,
    stoppedAt: isoDateTimeSchema,
    cleanupConfirmed: z.literal(true),
    alreadyAbsent: z.boolean(),
  })
  .strict();

export const previewSessionSchema = z
  .object({
    previewId: previewIdSchema,
    executionId: identifierSchema,
    artifactId: z.string().regex(/^preview-artifact-[a-f0-9]{32}$/u),
    status: previewSessionStatusSchema,
    health: previewHealthStatusSchema,
    createdAt: isoDateTimeSchema,
    startedAt: isoDateTimeSchema.nullable(),
    expiresAt: isoDateTimeSchema,
    stoppingAt: isoDateTimeSchema.nullable(),
    stoppedAt: isoDateTimeSchema.nullable(),
    revision: z.number().int().nonnegative(),
    policy: z
      .object({ id: z.literal('NODE_WEB_PREVIEW_24_V1'), version: semanticVersionSchema })
      .strict(),
    artifact: z
      .object({
        profileId: z.literal('NODE_WEB_PREVIEW_24_V1'),
        fileCount: z.number().int().positive().max(128),
        totalBytes: z
          .number()
          .int()
          .positive()
          .max(1024 * 1024),
        expiresAt: isoDateTimeSchema,
      })
      .strict(),
    limits: previewEffectiveLimitsSchema,
    lineage: previewLineageSchema,
    provenance: previewProvenanceSchema,
    hashes: previewHashesSchema,
    failure: previewFailureSchema.nullable(),
  })
  .strict()
  .superRefine((session, context) => {
    if (Date.parse(session.expiresAt) <= Date.parse(session.createdAt)) {
      context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Expiração inválida.' });
    }
    if (Date.parse(session.expiresAt) > Date.parse(session.artifact.expiresAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'A sessão não pode sobreviver ao PreviewArtifact.',
      });
    }
    if (
      session.startedAt !== null &&
      Date.parse(session.startedAt) < Date.parse(session.createdAt)
    ) {
      context.addIssue({ code: 'custom', path: ['startedAt'], message: 'Start inválido.' });
    }
    if ((session.status === 'FAILED') !== (session.failure !== null)) {
      context.addIssue({ code: 'custom', path: ['failure'], message: 'Failure inconsistente.' });
    }
    if (
      session.status === 'RUNNING' &&
      (session.startedAt === null || session.health !== 'HEALTHY')
    ) {
      context.addIssue({ code: 'custom', message: 'RUNNING exige start e health.' });
    }
    if (['CREATED', 'STARTING'].includes(session.status) && session.health !== 'PENDING') {
      context.addIssue({ code: 'custom', path: ['health'], message: 'Health inicial inválido.' });
    }
    if (
      ['STOPPING', 'STOPPED', 'EXPIRED'].includes(session.status) &&
      session.stoppingAt === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['stoppingAt'],
        message: 'StoppingAt obrigatório.',
      });
    }
    if (['STOPPED', 'EXPIRED'].includes(session.status)) {
      if (session.stoppedAt === null || session.health !== 'NOT_APPLICABLE') {
        context.addIssue({ code: 'custom', message: 'Estado terminal limpo inválido.' });
      }
    } else if (session.stoppedAt !== null) {
      context.addIssue({ code: 'custom', path: ['stoppedAt'], message: 'StoppedAt inesperado.' });
    }
    const lineageHash = calculatePreviewLineageHash(session.lineage);
    const provenanceHash = calculatePreviewProvenanceHash(session.provenance);
    const sessionHash = calculatePreviewSessionHash({
      previewId: session.previewId,
      executionId: session.executionId,
      artifactId: session.artifactId,
      previewRequestHash: session.hashes.previewRequestHash,
      policyHash: session.hashes.policyHash,
      limitsHash: session.hashes.limitsHash,
      lineageHash,
    });
    if (
      session.hashes.factoryResultHash !== session.lineage.factoryResultHash ||
      session.hashes.sandboxRequestHash !== session.lineage.sandboxRequestHash ||
      session.hashes.sandboxResultHash !== session.lineage.sandboxResultHash ||
      session.hashes.workspaceHash !== session.lineage.workspaceHash ||
      session.hashes.artifactHash !== session.lineage.artifactHash ||
      session.hashes.artifactApprovalHash !== session.lineage.artifactApprovalHash ||
      session.hashes.lineageHash !== lineageHash ||
      session.hashes.provenanceHash !== provenanceHash ||
      session.hashes.previewSessionHash !== sessionHash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['hashes'],
        message: 'Hashes da sessão inválidos.',
      });
    }
  });

const PREVIEW_EVENT_STATUS = Object.freeze({
  'preview.requested': 'CREATED',
  'preview.starting': 'STARTING',
  'preview.running': 'RUNNING',
  'preview.failed': 'FAILED',
  'preview.stopping': 'STOPPING',
  'preview.stopped': 'STOPPED',
  'preview.expired': 'EXPIRED',
} as const);

export const previewSessionEventSchema = z
  .object({
    previewId: previewIdSchema,
    executionId: identifierSchema,
    sequence: z.number().int().positive(),
    event: previewObservabilityEventNameSchema,
    status: previewSessionStatusSchema,
    occurredAt: isoDateTimeSchema,
    durationMs: z.number().int().nonnegative().nullable(),
    policyId: z.literal('NODE_WEB_PREVIEW_24_V1'),
    hashes: z
      .object({
        artifactHash: previewHashSchema,
        previewRequestHash: previewHashSchema,
        previewSessionHash: previewHashSchema,
      })
      .strict(),
    failureCode: z.enum(Object.values(PREVIEW_RUNNER_ERROR_CODES)).nullable(),
    contractVersion: z.literal(PREVIEW_OBSERVABILITY_CONTRACT_VERSION),
  })
  .strict()
  .superRefine((event, context) => {
    if (PREVIEW_EVENT_STATUS[event.event] !== event.status) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'O status não corresponde ao evento de Preview.',
      });
    }
  });
