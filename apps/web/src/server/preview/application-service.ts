import { randomBytes } from 'node:crypto';

import type {
  ExecutionRecord,
  ExecutionRecordRepository,
  PreviewPersistenceRepository,
} from '@brq/execution-repository';
import {
  PREVIEW_RUNNER_ERROR_CODES,
  PreviewRunnerError,
  type PreviewSession,
  type PreviewSessionCoordinator,
} from '@brq/preview-runner';

import {
  executionPreviewControlSchema,
  previewSessionViewSchema,
  type ExecutionPreviewControl,
  type PreviewEligibilityStatus,
  type PreviewSessionView,
} from '@/api/preview-contracts';
import type { AuthenticatedPrincipal } from '@/server/auth/contracts';

import { hashPreviewAccessTicket } from './access-credentials';
import {
  PreviewApplicationError,
  type PreviewApplicationErrorCode,
  type PreviewApplicationService,
} from './contracts';
import { previewOriginForId } from './configuration';

const ACCESS_TICKET_TTL_MS = 60_000;

interface PreviewPrincipalContext {
  readonly executionRepository: ExecutionRecordRepository;
  readonly previewRepository: PreviewPersistenceRepository;
  readonly coordinator: PreviewSessionCoordinator;
}

interface CreatePreviewApplicationServiceOptions {
  readonly contextForPrincipal: (principal: AuthenticatedPrincipal) => PreviewPrincipalContext;
  readonly originTemplate: string;
  readonly now?: () => number;
  readonly ticketFactory?: () => string;
}

function currentTimestamp(now: () => number): string {
  const observed = now();
  if (!Number.isFinite(observed) || observed < 0) {
    throw new PreviewApplicationError(
      'O serviço de Preview não está disponível.',
      'PREVIEW_CONFIGURATION_INVALID',
    );
  }
  return new Date(Math.round(observed)).toISOString();
}

function projectSession(session: PreviewSession): PreviewSessionView {
  return previewSessionViewSchema.parse({
    previewId: session.previewId,
    executionId: session.executionId,
    status: session.status,
    health: session.health,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    stoppedAt: session.stoppedAt,
    policy: session.policy,
    hashes: {
      factoryResultHash: session.hashes.factoryResultHash,
      artifactHash: session.hashes.artifactHash,
      previewRequestHash: session.hashes.previewRequestHash,
      previewSessionHash: session.hashes.previewSessionHash,
    },
    controlPath: `/executions/${session.executionId}/preview`,
    failure: session.failure === null ? null : { code: session.failure.code },
  });
}

function factoryEligibility(
  record: ExecutionRecord,
  artifact: Awaited<ReturnType<PreviewPersistenceRepository['findArtifactMetadataByExecutionId']>>,
  observedAt: string,
): PreviewEligibilityStatus {
  const factory = record.factoryResult;
  if (factory === null) return 'FACTORY_RESULT_MISSING';
  if (
    factory.status !== 'SUCCESS' ||
    factory.sandboxStatus !== 'SUCCESS' ||
    factory.workspaceReleaseStatus !== 'RELEASED'
  ) {
    return 'FACTORY_NOT_SUCCESS';
  }
  if (
    artifact === null ||
    artifact.status !== 'APPROVED' ||
    artifact.approval === null ||
    artifact.hashes.approvalHash === null
  ) {
    return 'ARTIFACT_UNAVAILABLE';
  }
  if (Date.parse(artifact.expiresAt) <= Date.parse(observedAt)) {
    return 'ARTIFACT_UNAVAILABLE';
  }
  if (artifact.metadata.profileId !== 'NODE_WEB_PREVIEW_24_V1') {
    return 'PROFILE_UNSUPPORTED';
  }
  if (
    artifact.source.executionId !== record.executionId ||
    artifact.approval.factoryResultHash !== factory.hashes.factoryResultHash ||
    artifact.approval.sandboxResultHash !== factory.lineage.sandboxResultHash ||
    artifact.source.sandboxRequestHash !== factory.lineage.sandboxRequestHash ||
    artifact.source.workspaceHash !== factory.lineage.workspaceHash
  ) {
    return 'ARTIFACT_UNAVAILABLE';
  }
  return 'ELIGIBLE';
}

function eligibilityError(status: PreviewEligibilityStatus): PreviewApplicationError {
  const values: Record<
    Exclude<PreviewEligibilityStatus, 'ELIGIBLE'>,
    readonly [PreviewApplicationErrorCode, string]
  > = {
    FACTORY_RESULT_MISSING: [
      'PREVIEW_FACTORY_NOT_SUCCESS',
      'A execução não possui um resultado completo da Factory.',
    ],
    FACTORY_NOT_SUCCESS: [
      'PREVIEW_FACTORY_NOT_SUCCESS',
      'Preview exige uma execução Factory bem-sucedida.',
    ],
    ARTIFACT_UNAVAILABLE: [
      'PREVIEW_ARTIFACT_UNAVAILABLE',
      'O artifact aprovado de Preview não está disponível.',
    ],
    PROFILE_UNSUPPORTED: [
      'PREVIEW_PROFILE_UNSUPPORTED',
      'O profile desta execução não permite Preview.',
    ],
  };
  const [code, message] = values[status as Exclude<PreviewEligibilityStatus, 'ELIGIBLE'>];
  return new PreviewApplicationError(message, code);
}

function mapRunnerError(error: unknown): never {
  if (!(error instanceof PreviewRunnerError)) throw error;
  const allowed = new Set<PreviewApplicationErrorCode>([
    'PREVIEW_NOT_ALLOWED',
    'PREVIEW_FACTORY_NOT_SUCCESS',
    'PREVIEW_ARTIFACT_UNAVAILABLE',
    'PREVIEW_PROFILE_UNSUPPORTED',
    'PREVIEW_POLICY_MISMATCH',
    'PREVIEW_CONFIGURATION_INVALID',
    'PREVIEW_CAPACITY_EXCEEDED',
    'PREVIEW_RUNTIME_UNAVAILABLE',
    'PREVIEW_IMAGE_VERIFICATION_FAILED',
    'PREVIEW_START_FAILED',
    'PREVIEW_START_TIMEOUT',
    'PREVIEW_HEALTHCHECK_FAILED',
    'PREVIEW_RUNTIME_LOST',
    'PREVIEW_STOP_FAILED',
    'PREVIEW_CLEANUP_FAILED',
    'PREVIEW_CONFLICT',
  ]);
  const code = allowed.has(error.code as PreviewApplicationErrorCode)
    ? (error.code as PreviewApplicationErrorCode)
    : error.code === PREVIEW_RUNNER_ERROR_CODES.NOT_FOUND
      ? 'PREVIEW_NOT_ALLOWED'
      : 'PREVIEW_CONFLICT';
  throw new PreviewApplicationError('A operação de Preview não pôde ser concluída.', code, error);
}

async function reconcileSession(
  session: PreviewSession,
  context: PreviewPrincipalContext,
  observedAt: string,
): Promise<PreviewSession> {
  try {
    if (
      !['STOPPED', 'EXPIRED', 'FAILED'].includes(session.status) &&
      Date.parse(session.expiresAt) <= Date.parse(observedAt)
    ) {
      return await context.coordinator.expire(session.previewId);
    }
    if (session.status === 'RUNNING') return await context.coordinator.reconcile(session.previewId);
    return session;
  } catch (error) {
    return mapRunnerError(error);
  }
}

export function createPreviewApplicationService(
  options: CreatePreviewApplicationServiceOptions,
): PreviewApplicationService {
  const now = options.now ?? Date.now;
  const ticketFactory = options.ticketFactory ?? (() => randomBytes(32).toString('base64url'));

  const findExecution = async (
    executionId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<{ readonly context: PreviewPrincipalContext; readonly record: ExecutionRecord }> => {
    const context = options.contextForPrincipal(principal);
    const record = await context.executionRepository.findByExecutionId(executionId);
    if (record === null || record.executionId !== executionId) {
      throw new PreviewApplicationError('A execução não foi encontrada.', 'PREVIEW_NOT_ALLOWED');
    }
    return { context, record };
  };

  const findSession = async (
    previewId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<{
    readonly context: PreviewPrincipalContext;
    readonly session: PreviewSession;
  } | null> => {
    const context = options.contextForPrincipal(principal);
    const session = await context.previewRepository.getByPreviewId(previewId);
    if (session === null) return null;
    return {
      context,
      session: await reconcileSession(session, context, currentTimestamp(now)),
    };
  };

  const service: PreviewApplicationService = {
    async getExecutionControl(executionId, principal): Promise<ExecutionPreviewControl> {
      const { context, record } = await findExecution(executionId, principal);
      const existing = await context.previewRepository.getByExecutionId(executionId);
      const session =
        existing === null ? null : await reconcileSession(existing, context, currentTimestamp(now));
      const artifact =
        await context.previewRepository.findArtifactMetadataByExecutionId(executionId);
      const observedAt = currentTimestamp(now);
      return executionPreviewControlSchema.parse({
        eligibility: {
          status:
            session !== null && !['STOPPED', 'EXPIRED', 'FAILED'].includes(session.status)
              ? 'ELIGIBLE'
              : factoryEligibility(record, artifact, observedAt),
        },
        session: session === null ? null : projectSession(session),
      });
    },

    async start(executionId, principal, input, requestContext) {
      const { context, record } = await findExecution(executionId, principal);
      const artifact =
        await context.previewRepository.findArtifactMetadataByExecutionId(executionId);
      const eligibility = factoryEligibility(record, artifact, currentTimestamp(now));
      if (eligibility !== 'ELIGIBLE' || artifact === null || artifact.status !== 'APPROVED') {
        throw eligibilityError(eligibility);
      }
      try {
        return projectSession(
          await context.coordinator.start(
            {
              executionId,
              artifact,
              policyId: 'NODE_WEB_PREVIEW_24_V1',
              ...(input.ttlSeconds === undefined
                ? {}
                : { limits: { ttlSeconds: input.ttlSeconds } }),
              requestId: requestContext.requestId,
            },
            { signal: requestContext.signal },
          ),
        );
      } catch (error) {
        return mapRunnerError(error);
      }
    },

    async get(previewId, principal) {
      const found = await findSession(previewId, principal);
      return found === null ? null : projectSession(found.session);
    },

    async stop(previewId, principal) {
      const found = await findSession(previewId, principal);
      if (found === null) return null;
      try {
        const session = await found.context.coordinator.stop(previewId);
        await found.context.previewRepository.revokeAccessTicket({
          previewId,
          revokedAt: currentTimestamp(now),
        });
        return projectSession(session);
      } catch (error) {
        return mapRunnerError(error);
      }
    },

    async createLaunch(previewId, principal) {
      const found = await findSession(previewId, principal);
      if (found === null) return null;
      const current = currentTimestamp(now);
      if (
        found.session.status !== 'RUNNING' ||
        found.session.health !== 'HEALTHY' ||
        Date.parse(found.session.expiresAt) <= Date.parse(current)
      ) {
        throw new PreviewApplicationError(
          'O Preview não está disponível para visualização.',
          'PREVIEW_CONFLICT',
        );
      }
      const ticket = ticketFactory();
      const expiresAt = new Date(
        Math.min(Date.parse(current) + ACCESS_TICKET_TTL_MS, Date.parse(found.session.expiresAt)),
      ).toISOString();
      await found.context.previewRepository.issueAccessTicket({
        previewId,
        ticketHash: hashPreviewAccessTicket(ticket),
        issuedAt: current,
        expiresAt,
      });
      return Object.freeze({
        previewId,
        redeemUrl: `${previewOriginForId(options.originTemplate, previewId)}/_brq/redeem`,
        ticket,
        expiresAt,
      });
    },
  };
  return Object.freeze(service);
}
