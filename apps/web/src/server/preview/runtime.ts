import { createFilesystemPreviewArtifactStore } from '@brq/preview-artifact/filesystem';
import type { PreviewArtifactContentStore } from '@brq/preview-artifact';
import { PrismaExecutionRecordRepository } from '@brq/execution-repository/prisma';
import { PrismaPreviewRepository } from '@brq/execution-repository/preview-prisma';
import {
  createPreviewSessionCoordinator,
  NODE_WEB_PREVIEW_24_V1_POLICY,
  type PreviewSessionCoordinator,
} from '@brq/preview-runner';
import { createDockerPreviewRunner } from '@brq/preview-runner/docker';
import type { DatabaseClient } from '@brq/prisma';
import type { Logger } from '@brq/shared/logger/logger';

import type { PreviewSessionView } from '@/api/preview-contracts';
import type { AuthenticatedPrincipal } from '@/server/auth/contracts';

import { createPreviewApplicationService } from './application-service';
import {
  createFactoryPreviewArtifactIntegration,
  createPersistentPreviewArtifactStore,
  type FactoryPreviewArtifactIntegration,
} from './artifact-integration';
import {
  resolvePreviewArtifactRuntimeConfiguration,
  resolvePreviewRuntimeConfiguration,
} from './configuration';
import type { PreviewApplicationService } from './contracts';
import type { PreviewGatewayService } from './gateway-contracts';
import { createPreviewGatewayService } from './gateway-service';

const ACTIVE_PREVIEW_STATUSES = ['CREATED', 'STARTING', 'RUNNING', 'STOPPING'] as const;
const STARTUP_RECONCILIATION_LIMIT = 32;

export interface ApplicationPreviewRuntime {
  readonly applicationService: PreviewApplicationService;
  readonly gatewayService: PreviewGatewayService;
  readonly originTemplate: string;
  shutdown(): Promise<void>;
}

interface CreateApplicationPreviewRuntimeOptions {
  readonly client: DatabaseClient;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly logger?: Logger;
  readonly now?: () => number;
}

interface PreviewExpirationScheduler {
  schedule(previewId: string, expiresAt: string): void;
  cancel(previewId: string): void;
  shutdown(): Promise<void>;
}

interface PreviewArtifactExpirationScheduler {
  schedule(artifactId: string, expiresAt: string): void;
  shutdown(): Promise<void>;
}

function createExpirationScheduler(
  coordinator: PreviewSessionCoordinator,
  now: () => number,
): PreviewExpirationScheduler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const inFlight = new Set<Promise<unknown>>();
  const cancel = (previewId: string) => {
    const timer = timers.get(previewId);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(previewId);
  };
  const scheduler: PreviewExpirationScheduler = {
    schedule(previewId, expiresAt) {
      cancel(previewId);
      const delay = Math.max(0, Date.parse(expiresAt) - now());
      const timer = setTimeout(() => {
        timers.delete(previewId);
        const operation = coordinator.expire(previewId).catch(() => undefined);
        inFlight.add(operation);
        void operation.finally(() => inFlight.delete(operation));
      }, delay);
      timer.unref?.();
      timers.set(previewId, timer);
    },
    cancel,
    async shutdown() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await Promise.allSettled([...inFlight]);
    },
  };
  return Object.freeze(scheduler);
}

function createArtifactExpirationScheduler(
  store: PreviewArtifactContentStore,
  now: () => number,
): PreviewArtifactExpirationScheduler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const inFlight = new Set<Promise<unknown>>();
  const scheduler: PreviewArtifactExpirationScheduler = {
    schedule(artifactId, expiresAt) {
      const existing = timers.get(artifactId);
      if (existing !== undefined) clearTimeout(existing);
      const timer = setTimeout(
        () => {
          timers.delete(artifactId);
          const operation = (async () => {
            const observedAt = new Date(Math.round(now())).toISOString();
            try {
              await store.expire(artifactId, observedAt);
            } catch {
              // The artifact may already be consumed or terminal; removal is still required.
            }
            await store.remove(artifactId, observedAt);
          })().catch(() => undefined);
          inFlight.add(operation);
          void operation.finally(() => inFlight.delete(operation));
        },
        Math.max(0, Date.parse(expiresAt) - now()),
      );
      timer.unref?.();
      timers.set(artifactId, timer);
    },
    async shutdown() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await Promise.allSettled([...inFlight]);
    },
  };
  return Object.freeze(scheduler);
}

function scopedAccess(principal: AuthenticatedPrincipal) {
  return principal.role === 'ADMIN'
    ? ({ access: 'GLOBAL_PREVIEW' } as const)
    : ({ access: 'OWNER', userId: principal.userId } as const);
}

function wrapScheduledService(
  service: PreviewApplicationService,
  scheduler: PreviewExpirationScheduler,
): PreviewApplicationService {
  const schedule = (session: PreviewSessionView) => {
    if (session.status === 'RUNNING') scheduler.schedule(session.previewId, session.expiresAt);
    else if (['STOPPED', 'EXPIRED', 'FAILED'].includes(session.status)) {
      scheduler.cancel(session.previewId);
    }
    return session;
  };
  const scheduledService: PreviewApplicationService = {
    getExecutionControl: (executionId, principal) =>
      service.getExecutionControl(executionId, principal),
    async start(executionId, principal, input, context) {
      return schedule(await service.start(executionId, principal, input, context));
    },
    async get(previewId, principal) {
      const session = await service.get(previewId, principal);
      return session === null ? null : schedule(session);
    },
    async stop(previewId, principal, context) {
      const session = await service.stop(previewId, principal, context);
      return session === null ? null : schedule(session);
    },
    createLaunch: (previewId, principal, context) =>
      service.createLaunch(previewId, principal, context),
  };
  return Object.freeze(scheduledService);
}

export async function createApplicationPreviewRuntime(
  options: CreateApplicationPreviewRuntimeOptions,
): Promise<ApplicationPreviewRuntime> {
  const configuration = resolvePreviewRuntimeConfiguration(options.environment);
  const now = options.now ?? Date.now;
  const internalMetadata = new PrismaPreviewRepository(options.client, { access: 'INTERNAL' });
  const contentStore = createPersistentPreviewArtifactStore({
    store: createFilesystemPreviewArtifactStore({ rootPath: configuration.artifactRoot }),
    metadataRepository: internalMetadata,
  });
  const runner = createDockerPreviewRunner({
    dockerExecutable: configuration.dockerExecutable,
    dockerHost: configuration.dockerHost,
    image: Object.freeze({ ...configuration.image, requiredLabels: Object.freeze({}) }),
    contentStore,
    now,
  });
  const globalRepository = new PrismaPreviewRepository(options.client, {
    access: 'GLOBAL_PREVIEW',
  });
  const globalCoordinator = createPreviewSessionCoordinator({
    runner,
    store: globalRepository,
    policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    now,
  });
  const scheduler = createExpirationScheduler(globalCoordinator, now);
  const artifactScheduler = createArtifactExpirationScheduler(contentStore, now);
  const baseService = createPreviewApplicationService({
    originTemplate: configuration.originTemplate,
    now,
    contextForPrincipal(principal) {
      const access = scopedAccess(principal);
      const previewRepository = new PrismaPreviewRepository(options.client, access);
      return Object.freeze({
        executionRepository: new PrismaExecutionRecordRepository(
          options.client,
          principal.role === 'ADMIN'
            ? { access: 'GLOBAL_READ_ONLY' }
            : { access: 'OWNER', userId: principal.userId },
        ),
        previewRepository,
        coordinator: createPreviewSessionCoordinator({
          runner,
          store: previewRepository,
          policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
          ...(options.logger === undefined ? {} : { logger: options.logger }),
          now,
        }),
      });
    },
  });

  const observedAt = new Date(Math.round(now()));
  const expiredArtifacts = await options.client.previewArtifact.findMany({
    where: {
      status: { in: ['CANDIDATE', 'APPROVED'] },
      expiresAt: { lte: observedAt },
    },
    orderBy: { expiresAt: 'asc' },
    take: STARTUP_RECONCILIATION_LIMIT,
    select: { artifactId: true },
  });
  for (const { artifactId } of expiredArtifacts) {
    try {
      await contentStore.expire(artifactId, observedAt.toISOString());
    } catch {
      // The artifact may already have transitioned; physical removal is still attempted.
    }
    try {
      await contentStore.remove(artifactId, observedAt.toISOString());
    } catch {
      // Startup artifact cleanup is bounded and best effort; eligibility remains fail closed.
    }
  }

  const pendingArtifacts = await options.client.previewArtifact.findMany({
    where: {
      status: 'APPROVED',
      expiresAt: { gt: observedAt },
    },
    orderBy: { expiresAt: 'asc' },
    take: STARTUP_RECONCILIATION_LIMIT,
    select: { artifactId: true, expiresAt: true },
  });
  for (const artifact of pendingArtifacts) {
    artifactScheduler.schedule(artifact.artifactId, artifact.expiresAt.toISOString());
  }

  const [activePersisted, failedPersisted] = await Promise.all([
    options.client.previewSession.findMany({
      where: { status: { in: [...ACTIVE_PREVIEW_STATUSES] } },
      orderBy: { createdAt: 'asc' },
      take: STARTUP_RECONCILIATION_LIMIT,
      select: { previewId: true },
    }),
    options.client.previewSession.findMany({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: STARTUP_RECONCILIATION_LIMIT,
      select: { previewId: true },
    }),
  ]);
  const persisted = [...activePersisted, ...failedPersisted];
  for (const { previewId } of persisted) {
    try {
      const reconciled = await globalCoordinator.reconcile(previewId);
      if (reconciled.status === 'RUNNING') scheduler.schedule(previewId, reconciled.expiresAt);
    } catch {
      // Startup reconciliation is bounded and best effort; state remains safe and inspectable.
    }
  }

  return Object.freeze({
    applicationService: wrapScheduledService(baseService, scheduler),
    gatewayService: createPreviewGatewayService({
      redeemRepository: new PrismaPreviewRepository(options.client, { access: 'TICKET_REDEEM' }),
      sessionRepository: globalRepository,
      locator: {
        resolveGatewayTarget: async (request) => runner.resolveGatewayTarget(request),
      },
      cookieSecret: configuration.cookieSecret,
      now,
    }),
    originTemplate: configuration.originTemplate,
    async shutdown() {
      const active = await options.client.previewSession.findMany({
        where: { status: { in: [...ACTIVE_PREVIEW_STATUSES] } },
        orderBy: { createdAt: 'asc' },
        take: STARTUP_RECONCILIATION_LIMIT,
        select: { previewId: true },
      });
      await Promise.allSettled(active.map(({ previewId }) => globalCoordinator.stop(previewId)));
      await Promise.all([scheduler.shutdown(), artifactScheduler.shutdown()]);
    },
  });
}

export function createApplicationFactoryPreviewArtifactIntegration(options: {
  readonly client: DatabaseClient;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly sandboxPolicyId: string;
  readonly now?: () => number;
}): FactoryPreviewArtifactIntegration {
  const configuration = resolvePreviewArtifactRuntimeConfiguration(options.environment);
  const metadataRepository = new PrismaPreviewRepository(options.client, { access: 'INTERNAL' });
  return createFactoryPreviewArtifactIntegration({
    store: createFilesystemPreviewArtifactStore({ rootPath: configuration.artifactRoot }),
    metadataRepository,
    sandboxPolicyId: options.sandboxPolicyId,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}
