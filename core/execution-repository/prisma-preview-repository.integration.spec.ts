import {
  projectApprovedPreviewArtifactDescriptor,
  projectPreviewArtifactDescriptor,
} from '@brq/preview-artifact';
import {
  createApprovedPreviewArtifactFixture,
  createPreviewArtifactCandidateFixture,
} from '@brq/preview-artifact/testing';
import {
  createPreviewSessionEvent,
  transitionPreviewSession,
  type PreviewSession,
} from '@brq/preview-runner';
import {
  createPreviewRuntimeObservationFixture,
  createResolvedPreviewFixture,
} from '@brq/preview-runner/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabaseTestContext,
  type DatabaseTestContext,
} from '../../prisma/tests/database-test-context';
import { PrismaPreviewRepository } from './adapters/prisma-preview-repository';
import { EXECUTION_REPOSITORY_ERROR_CODES } from './errors';

const OWNER_USER_ID = 'user-preview-owner';
const OTHER_USER_ID = 'user-preview-other';
const EXECUTION_ID = 'execution-preview-fixture-001';

async function seedSuccessfulFactory(
  context: DatabaseTestContext,
  factoryResultHash = 'c'.repeat(64),
): Promise<void> {
  await context.client.user.createMany({
    data: [
      {
        id: OWNER_USER_ID,
        email: 'preview-owner@example.com',
        name: 'Preview Owner',
        role: 'USER',
        updatedAt: new Date('2026-08-10T12:00:00.000Z'),
      },
      {
        id: OTHER_USER_ID,
        email: 'preview-other@example.com',
        name: 'Preview Other',
        role: 'USER',
        updatedAt: new Date('2026-08-10T12:00:00.000Z'),
      },
    ],
  });
  await context.client.executionRecord.create({
    data: {
      userId: OWNER_USER_ID,
      workflowId: 'workflow-preview-fixture-001',
      executionId: EXECUTION_ID,
      projectName: 'Preview metadata fixture',
      status: 'SUCCESS',
      workflowStatus: 'SUCCESS',
      readiness: 'READY',
      createdAt: new Date('2026-08-10T11:59:00.000Z'),
      startedAt: new Date('2026-08-10T11:59:01.000Z'),
      finishedAt: new Date('2026-08-10T12:00:20.000Z'),
      durationMs: 80_000,
      engineVersion: '1.0.0',
      contractVersion: '1.0.0',
      factoryResult: {
        create: {
          factoryVersion: '1.0.0',
          contractVersion: '1.0.0',
          status: 'SUCCESS',
          startedAt: new Date('2026-08-10T11:59:01.000Z'),
          finishedAt: new Date('2026-08-10T12:00:20.000Z'),
          durationMs: 79_000,
          readiness: 'READY',
          terminalStage: 'WORKSPACE_RELEASE',
          factoryResultHash,
          lineageHash: 'e'.repeat(64),
          provenanceHash: 'f'.repeat(64),
          generationStatus: 'SUCCESS',
          generatedFileCount: 3,
          generatedTotalBytes: 100,
          workspaceFileCount: 3,
          workspaceTotalBytes: 100,
          workspaceReleaseStatus: 'RELEASED',
          sandboxStatus: 'SUCCESS',
          sandboxResourceOutcome: 'NONE',
          lineage: {
            create: {
              executionHash: '9'.repeat(64),
              workspaceHash: 'a'.repeat(64),
              sandboxRequestHash: 'b'.repeat(64),
              sandboxResultHash: 'd'.repeat(64),
              factoryResultHash,
            },
          },
        },
      },
    },
  });
}

async function persistApprovedArtifact(context: DatabaseTestContext): Promise<void> {
  const internal = new PrismaPreviewRepository(context.client, { access: 'INTERNAL' });
  await internal.saveArtifactMetadata(
    projectPreviewArtifactDescriptor(createPreviewArtifactCandidateFixture()),
  );
  await internal.saveArtifactMetadata(
    projectApprovedPreviewArtifactDescriptor(createApprovedPreviewArtifactFixture()),
  );
}

async function persistRunningSession(context: DatabaseTestContext): Promise<PreviewSession> {
  await persistApprovedArtifact(context);
  const owner = new PrismaPreviewRepository(context.client, {
    access: 'OWNER',
    userId: OWNER_USER_ID,
  });
  const resolved = createResolvedPreviewFixture();
  await owner.createOrGet(
    resolved.session,
    createPreviewSessionEvent(resolved.session, 'preview.requested', resolved.session.createdAt),
  );
  const starting = transitionPreviewSession({
    session: resolved.session,
    status: 'STARTING',
    observedAt: '2026-08-10T12:01:01.000Z',
  });
  await owner.replace(
    resolved.session.revision,
    starting,
    createPreviewSessionEvent(starting, 'preview.starting', '2026-08-10T12:01:01.000Z'),
  );
  const running = transitionPreviewSession({
    session: starting,
    status: 'RUNNING',
    observedAt: '2026-08-10T12:01:02.000Z',
    runtime: createPreviewRuntimeObservationFixture(),
  });
  return owner.replace(
    starting.revision,
    running,
    createPreviewSessionEvent(running, 'preview.running', '2026-08-10T12:01:02.000Z'),
  );
}

describe('Prisma Preview persistence repository', () => {
  let context: DatabaseTestContext;

  beforeEach(async () => {
    context = await createDatabaseTestContext();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it('round-trips metadata normalizada com owner/admin scope e eventos append-only', async () => {
    await seedSuccessfulFactory(context);
    const running = await persistRunningSession(context);
    const restartedOwner = new PrismaPreviewRepository(context.client, {
      access: 'OWNER',
      userId: OWNER_USER_ID,
    });
    const other = new PrismaPreviewRepository(context.client, {
      access: 'OWNER',
      userId: OTHER_USER_ID,
    });
    const admin = new PrismaPreviewRepository(context.client, { access: 'GLOBAL_PREVIEW' });

    expect(await restartedOwner.getByPreviewId(running.previewId)).toEqual(running);
    expect(await other.getByExecutionId(EXECUTION_ID)).toBeNull();
    expect(await admin.getByExecutionId(EXECUTION_ID)).toEqual(running);
    const resolved = createResolvedPreviewFixture();
    expect(
      await admin.createOrGet(
        resolved.session,
        createPreviewSessionEvent(
          resolved.session,
          'preview.requested',
          resolved.session.createdAt,
        ),
      ),
    ).toEqual({ created: false, session: running });
    await expect(
      other.createOrGet(
        resolved.session,
        createPreviewSessionEvent(
          resolved.session,
          'preview.requested',
          resolved.session.createdAt,
        ),
      ),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND });
    expect(
      (await restartedOwner.listEvents(running.previewId)).map((event) => event.event),
    ).toEqual(['preview.requested', 'preview.starting', 'preview.running']);
    expect(Object.isFrozen(running)).toBe(true);
    expect(Object.isFrozen(running.provenance.runtime)).toBe(true);
    expect(await context.client.previewArtifact.count()).toBe(1);
    expect(await context.client.previewSession.count()).toBe(1);
    expect(await context.client.previewSessionEvent.count()).toBe(3);
    expect(await context.client.previewSessionProvenance.count()).toBe(1);

    const storedArtifact = await context.client.previewArtifact.findUnique({
      where: { artifactId: running.artifactId },
    });
    const storedSession = await context.client.previewSession.findUnique({
      where: { previewId: running.previewId },
    });
    const serialized = JSON.stringify({ storedArtifact, storedSession });
    expect(serialized).not.toContain('<!doctype html>');
    expect(serialized).not.toContain('/private/');
    expect(serialized).not.toContain('containerId');
    expect(serialized).not.toContain('hostPort');
    expect(serialized).not.toContain('stdout');
    expect(serialized).not.toContain('stderr');
  });

  it('rejeita aprovação cujo binding não corresponde ao FactoryResult persistido', async () => {
    await seedSuccessfulFactory(context, '0'.repeat(64));
    const internal = new PrismaPreviewRepository(context.client, { access: 'INTERNAL' });
    await internal.saveArtifactMetadata(
      projectPreviewArtifactDescriptor(createPreviewArtifactCandidateFixture()),
    );

    await expect(
      internal.saveArtifactMetadata(
        projectApprovedPreviewArtifactDescriptor(createApprovedPreviewArtifactFixture()),
      ),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
    expect((await context.client.previewArtifact.findFirst())?.status).toBe('CANDIDATE');
    expect(await context.client.previewSession.count()).toBe(0);
  });

  it('implementa createOrGet atômico sem duplicar sessão ou evento inicial', async () => {
    await seedSuccessfulFactory(context);
    await persistApprovedArtifact(context);
    const first = new PrismaPreviewRepository(context.client, {
      access: 'OWNER',
      userId: OWNER_USER_ID,
    });
    const second = new PrismaPreviewRepository(context.client, {
      access: 'OWNER',
      userId: OWNER_USER_ID,
    });
    const resolved = createResolvedPreviewFixture();
    const event = createPreviewSessionEvent(
      resolved.session,
      'preview.requested',
      resolved.session.createdAt,
    );

    const results = await Promise.all([
      first.createOrGet(resolved.session, event),
      second.createOrGet(resolved.session, event),
    ]);

    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(results[0]?.session).toEqual(results[1]?.session);
    expect(await context.client.previewSession.count()).toBe(1);
    expect(await context.client.previewSessionEvent.count()).toBe(1);
  });

  it('faz consume atômico e rotaciona ticket one-shot após consumo', async () => {
    await seedSuccessfulFactory(context);
    const running = await persistRunningSession(context);
    const owner = new PrismaPreviewRepository(context.client, {
      access: 'OWNER',
      userId: OWNER_USER_ID,
    });
    const gateway = new PrismaPreviewRepository(context.client, { access: 'TICKET_REDEEM' });
    const first = {
      previewId: running.previewId,
      ticketHash: '1'.repeat(64),
      issuedAt: '2026-08-10T12:02:00.000Z',
      expiresAt: '2026-08-10T12:03:00.000Z',
    } as const;
    await owner.issueAccessTicket(first);

    await expect(
      owner.issueAccessTicket({
        ...first,
        ticketHash: '2'.repeat(64),
        issuedAt: '2026-08-10T12:02:01.000Z',
      }),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
    const attempts = await Promise.all([
      gateway.consumeAccessTicket({
        ticketHash: first.ticketHash,
        consumedAt: '2026-08-10T12:02:10.000Z',
      }),
      gateway.consumeAccessTicket({
        ticketHash: first.ticketHash,
        consumedAt: '2026-08-10T12:02:10.000Z',
      }),
    ]);
    expect(attempts.filter((result) => result !== null)).toHaveLength(1);

    const second = {
      previewId: running.previewId,
      ticketHash: '2'.repeat(64),
      issuedAt: '2026-08-10T12:02:20.000Z',
      expiresAt: '2026-08-10T12:03:20.000Z',
    } as const;
    expect(await owner.issueAccessTicket(second)).toMatchObject({
      consumedAt: null,
      revokedAt: null,
    });
    const stored = await context.client.previewAccessTicket.findUnique({
      where: { previewSessionId: running.previewId },
    });
    expect(stored).toMatchObject({
      ticketHash: second.ticketHash,
      consumedAt: null,
      revokedAt: null,
    });
    expect(
      await gateway.consumeAccessTicket({
        ticketHash: first.ticketHash,
        consumedAt: '2026-08-10T12:02:21.000Z',
      }),
    ).toBeNull();

    const stopping = transitionPreviewSession({
      session: running,
      status: 'STOPPING',
      observedAt: '2026-08-10T12:02:30.000Z',
    });
    await owner.replace(
      running.revision,
      stopping,
      createPreviewSessionEvent(stopping, 'preview.stopping', '2026-08-10T12:02:30.000Z'),
    );
    expect(
      await context.client.previewAccessTicket.findUnique({
        where: { previewSessionId: running.previewId },
      }),
    ).toMatchObject({ revokedAt: new Date('2026-08-10T12:02:30.000Z') });
    expect(
      await gateway.consumeAccessTicket({
        ticketHash: second.ticketHash,
        consumedAt: '2026-08-10T12:02:31.000Z',
      }),
    ).toBeNull();
  });
});
