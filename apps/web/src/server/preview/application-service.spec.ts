import {
  approvePreviewArtifact,
  createPreviewArtifactCandidate,
  projectApprovedPreviewArtifactDescriptor,
  projectPreviewArtifactDescriptor,
} from '@brq/preview-artifact';
import { createPreviewArtifactFilesFixture } from '@brq/preview-artifact/testing';
import {
  createInMemoryExecutionRecordRepository,
  createInMemoryPreviewRepositoryDatabase,
  type ExecutionRecordRepository,
} from '@brq/execution-repository';
import { createFactoryExecutionResultFixture } from '@brq/factory-pipeline/testing';
import {
  createPreviewSessionCoordinator,
  NODE_WEB_PREVIEW_24_V1_POLICY,
} from '@brq/preview-runner';
import { createFakePreviewRunner } from '@brq/preview-runner/testing';
import { describe, expect, it } from 'vitest';

import type { AuthenticatedPrincipal } from '@/server/auth/contracts';

import { hashPreviewAccessTicket } from './access-credentials';
import { createPreviewApplicationService } from './application-service';

const executionId = `execution-${'a'.repeat(32)}`;
const ownerId = 'user-preview-owner';

function principal(userId: string, role: 'USER' | 'ADMIN' = 'USER'): AuthenticatedPrincipal {
  return {
    userId,
    role,
    user: {
      id: userId,
      email: `${userId}@example.local`,
      name: userId,
      role,
      createdAt: '2026-08-10T11:00:00.000Z',
      updatedAt: '2026-08-10T11:00:00.000Z',
    },
  };
}

async function fixture(
  options: {
    readonly artifactExpiresAt?: string;
    readonly now?: string;
    readonly omitFactoryResult?: boolean;
  } = {},
) {
  const factoryResult = createFactoryExecutionResultFixture({ executionId });
  const executionRepository = createInMemoryExecutionRecordRepository();
  await executionRepository.createQueued({
    workflowId: factoryResult.workflowId,
    executionId,
    jobId: `job-${'b'.repeat(32)}`,
    requestId: 'request-preview-001',
    traceId: 'trace-preview-001',
    projectName: 'Preview project',
    queuedAt: '2026-07-01T11:59:00.000Z',
    metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
  });
  await executionRepository.markJobRunning({
    jobId: `job-${'b'.repeat(32)}`,
    startedAt: '2026-07-01T11:59:01.000Z',
  });
  if (options.omitFactoryResult !== true) {
    await executionRepository.completeFactory(factoryResult.workflowId, factoryResult, null);
  }

  const database = createInMemoryPreviewRepositoryDatabase([
    {
      executionId,
      ownerUserId: ownerId,
      status: 'SUCCESS',
      factoryResult: {
        status: factoryResult.status,
        sandboxStatus: factoryResult.sandbox.status,
        workspaceReleaseStatus: factoryResult.workspace.releaseStatus,
        factoryResultHash: factoryResult.hashes.factoryResultHash,
        workspaceHash: factoryResult.hashes.workspaceHash!,
        sandboxRequestHash: factoryResult.hashes.sandboxRequestHash!,
        sandboxResultHash: factoryResult.hashes.sandboxResultHash!,
      },
    },
  ]);
  const candidate = createPreviewArtifactCandidate({
    executionId,
    workspaceHash: factoryResult.hashes.workspaceHash!,
    sandboxRequestHash: factoryResult.hashes.sandboxRequestHash!,
    profileId: 'NODE_WEB_PREVIEW_24_V1',
    exporterVersion: '1.0.0',
    createdAt: '2026-08-10T12:00:00.000Z',
    expiresAt: options.artifactExpiresAt ?? '2026-08-10T13:00:00.000Z',
    files: createPreviewArtifactFilesFixture(),
  });
  const artifact = approvePreviewArtifact({
    candidate,
    factoryStatus: 'SUCCESS',
    sandboxStatus: 'SUCCESS',
    workspaceReleaseStatus: 'RELEASED',
    factoryResultHash: factoryResult.hashes.factoryResultHash,
    sandboxResultHash: factoryResult.hashes.sandboxResultHash!,
    sandboxRequestHash: factoryResult.hashes.sandboxRequestHash!,
    workspaceHash: factoryResult.hashes.workspaceHash!,
    approvedAt: '2026-08-10T12:00:01.000Z',
  });
  const internal = database.repository({ access: 'INTERNAL' });
  await internal.saveArtifactMetadata(projectPreviewArtifactDescriptor(candidate));
  await internal.saveArtifactMetadata(projectApprovedPreviewArtifactDescriptor(artifact));
  const fake = createFakePreviewRunner();
  let currentTime = Date.parse(options.now ?? '2026-08-10T12:01:00.000Z');
  const clock = () => currentTime;
  const service = createPreviewApplicationService({
    originTemplate: 'http://{previewId}.preview.localhost:3000',
    now: clock,
    ticketFactory: () => 'T'.repeat(43),
    contextForPrincipal(user) {
      const permitted = user.role === 'ADMIN' || user.userId === ownerId;
      const previewRepository = database.repository(
        user.role === 'ADMIN'
          ? { access: 'GLOBAL_PREVIEW' }
          : { access: 'OWNER', userId: user.userId },
      );
      const scopedExecutionRepository: ExecutionRecordRepository = {
        ...executionRepository,
        findByExecutionId: (id) =>
          permitted ? executionRepository.findByExecutionId(id) : Promise.resolve(null),
      };
      return {
        executionRepository: scopedExecutionRepository,
        previewRepository,
        coordinator: createPreviewSessionCoordinator({
          runner: fake.runner,
          store: previewRepository,
          policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
          now: clock,
        }),
      };
    },
  });
  return {
    database,
    service,
    fake,
    setNow(value: string) {
      currentTime = Date.parse(value);
    },
  };
}

describe('PreviewApplicationService', () => {
  it('runs the explicit owner lifecycle and returns only the safe browser projection', async () => {
    const { service, fake } = await fixture();
    const user = principal(ownerId);
    await expect(service.getExecutionControl(executionId, user)).resolves.toMatchObject({
      eligibility: { status: 'ELIGIBLE' },
      session: null,
    });

    const session = await service.start(
      executionId,
      user,
      {},
      {
        requestId: 'request-preview-start',
        signal: new AbortController().signal,
      },
    );
    expect(session).toMatchObject({ executionId, status: 'RUNNING', health: 'HEALTHY' });
    expect(JSON.stringify(session)).not.toMatch(/containerId|hostPort|physicalPath/u);
    expect(fake.startRequests).toHaveLength(1);

    const grant = await service.createLaunch(session.previewId, user, {
      requestId: 'request-preview-launch',
    });
    expect(grant).toMatchObject({
      previewId: session.previewId,
      ticket: 'T'.repeat(43),
      redeemUrl: `http://${session.previewId}.preview.localhost:3000/_brq/redeem`,
    });

    await expect(
      service.stop(session.previewId, user, { requestId: 'request-preview-stop' }),
    ).resolves.toMatchObject({ status: 'STOPPED' });
    expect(fake.stopReasons).toEqual(['MANUAL']);
  });

  it('conceals a cross-owner execution while allowing explicit ADMIN access', async () => {
    const { service } = await fixture();
    await expect(
      service.getExecutionControl(executionId, principal('user-preview-other')),
    ).rejects.toMatchObject({ code: 'PREVIEW_NOT_ALLOWED' });
    await expect(
      service.getExecutionControl(executionId, principal('user-admin', 'ADMIN')),
    ).resolves.toMatchObject({ eligibility: { status: 'ELIGIBLE' } });
  });

  it('conceals a cross-owner Preview session from reads, launch and cleanup operations', async () => {
    const { service, fake } = await fixture();
    const owner = principal(ownerId);
    const session = await service.start(
      executionId,
      owner,
      {},
      {
        requestId: 'request-owner-start',
        signal: new AbortController().signal,
      },
    );
    const other = principal('user-preview-other');

    await expect(service.get(session.previewId, other)).resolves.toBeNull();
    await expect(
      service.createLaunch(session.previewId, other, { requestId: 'request-other-launch' }),
    ).resolves.toBeNull();
    await expect(
      service.stop(session.previewId, other, { requestId: 'request-other-stop' }),
    ).resolves.toBeNull();
    expect(fake.stopReasons).toEqual([]);
    await expect(
      service.get(session.previewId, principal('user-admin', 'ADMIN')),
    ).resolves.toMatchObject({ status: 'RUNNING' });
  });

  it('fails closed when the approved PreviewArtifact TTL has elapsed', async () => {
    const { service, fake } = await fixture({
      artifactExpiresAt: '2026-08-10T12:02:00.000Z',
      now: '2026-08-10T12:02:00.000Z',
    });
    const user = principal(ownerId);

    await expect(service.getExecutionControl(executionId, user)).resolves.toMatchObject({
      eligibility: { status: 'ARTIFACT_UNAVAILABLE' },
      session: null,
    });
    await expect(
      service.start(
        executionId,
        user,
        {},
        {
          requestId: 'request-expired-artifact',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({ code: 'PREVIEW_ARTIFACT_UNAVAILABLE' });
    expect(fake.startRequests).toHaveLength(0);
  });

  it('rejects a missing Factory result before runtime startup', async () => {
    const user = principal(ownerId);
    const missing = await fixture({ omitFactoryResult: true });
    await expect(missing.service.getExecutionControl(executionId, user)).resolves.toMatchObject({
      eligibility: { status: 'FACTORY_RESULT_MISSING' },
    });
    await expect(
      missing.service.start(
        executionId,
        user,
        {},
        {
          requestId: 'request-missing-factory',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({ code: 'PREVIEW_FACTORY_NOT_SUCCESS' });
    expect(missing.fake.startRequests).toHaveLength(0);
  });

  it('caps the one-time ticket to the session TTL and expires the runtime at the boundary', async () => {
    const { service, fake, setNow } = await fixture();
    const owner = principal(ownerId);
    const session = await service.start(
      executionId,
      owner,
      { ttlSeconds: 60 },
      { requestId: 'request-short-ttl', signal: new AbortController().signal },
    );
    setNow('2026-08-10T12:01:30.000Z');
    const grant = await service.createLaunch(session.previewId, owner, {
      requestId: 'request-short-launch',
    });
    expect(grant?.expiresAt).toBe(session.expiresAt);

    setNow(session.expiresAt);
    await expect(service.get(session.previewId, owner)).resolves.toMatchObject({
      status: 'EXPIRED',
      health: 'NOT_APPLICABLE',
    });
    expect(fake.stopReasons).toEqual(['EXPIRATION']);
    await expect(
      service.createLaunch(session.previewId, owner, { requestId: 'request-expired-launch' }),
    ).rejects.toMatchObject({ code: 'PREVIEW_CONFLICT' });
  });

  it('revokes an issued ticket even when runtime cleanup finishes as FAILED', async () => {
    const { database, service, fake } = await fixture();
    const owner = principal(ownerId);
    const session = await service.start(
      executionId,
      owner,
      {},
      {
        requestId: 'request-cleanup-start',
        signal: new AbortController().signal,
      },
    );
    const grant = await service.createLaunch(session.previewId, owner, {
      requestId: 'request-cleanup-launch',
    });
    fake.setStopError(new Error('SANITIZED_FAKE_CLEANUP_FAILURE'));

    await expect(
      service.stop(session.previewId, owner, { requestId: 'request-cleanup-stop' }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      failure: { code: 'PREVIEW_CLEANUP_FAILED' },
    });
    await expect(
      database.repository({ access: 'TICKET_REDEEM' }).consumeAccessTicket({
        ticketHash: hashPreviewAccessTicket(grant!.ticket),
        consumedAt: '2026-08-10T12:01:30.000Z',
      }),
    ).resolves.toBeNull();
  });
});
