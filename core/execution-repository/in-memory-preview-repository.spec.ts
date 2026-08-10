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
  PREVIEW_RUNNER_ERROR_CODES,
  PREVIEW_RUNNER_ERROR_STAGES,
  transitionPreviewSession,
  type PreviewSession,
} from '@brq/preview-runner';
import {
  createPreviewRuntimeObservationFixture,
  createResolvedPreviewFixture,
} from '@brq/preview-runner/testing';
import { describe, expect, it } from 'vitest';

import { createInMemoryPreviewRepositoryDatabase } from './adapters/in-memory-preview-repository';
import { EXECUTION_REPOSITORY_ERROR_CODES } from './errors';

const OWNER_USER_ID = 'user-preview-owner';
const OTHER_USER_ID = 'user-preview-other';
const EXECUTION_ID = 'execution-preview-fixture-001';

function executionSeed(factoryResultHash = 'c'.repeat(64)) {
  return {
    executionId: EXECUTION_ID,
    ownerUserId: OWNER_USER_ID,
    status: 'SUCCESS',
    factoryResult: {
      status: 'SUCCESS',
      sandboxStatus: 'SUCCESS',
      workspaceReleaseStatus: 'RELEASED',
      factoryResultHash,
      workspaceHash: 'a'.repeat(64),
      sandboxRequestHash: 'b'.repeat(64),
      sandboxResultHash: 'd'.repeat(64),
    },
  } as const;
}

async function persistedRunningSession(): Promise<{
  readonly database: ReturnType<typeof createInMemoryPreviewRepositoryDatabase>;
  readonly running: PreviewSession;
}> {
  const database = createInMemoryPreviewRepositoryDatabase([executionSeed()]);
  const internal = database.repository({ access: 'INTERNAL' });
  const owner = database.repository({ access: 'OWNER', userId: OWNER_USER_ID });
  await internal.saveArtifactMetadata(
    projectPreviewArtifactDescriptor(createPreviewArtifactCandidateFixture()),
  );
  await internal.saveArtifactMetadata(
    projectApprovedPreviewArtifactDescriptor(createApprovedPreviewArtifactFixture()),
  );
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
  return {
    database,
    running: await owner.replace(
      starting.revision,
      running,
      createPreviewSessionEvent(running, 'preview.running', '2026-08-10T12:01:02.000Z'),
    ),
  };
}

describe('in-memory Preview persistence repository', () => {
  it('persiste descriptors sem conteúdo e exige binding com Factory SUCCESS', async () => {
    const database = createInMemoryPreviewRepositoryDatabase([executionSeed()]);
    const internal = database.repository({ access: 'INTERNAL' });
    const owner = database.repository({ access: 'OWNER', userId: OWNER_USER_ID });
    const other = database.repository({ access: 'OWNER', userId: OTHER_USER_ID });
    const admin = database.repository({ access: 'GLOBAL_PREVIEW' });
    const candidate = projectPreviewArtifactDescriptor(createPreviewArtifactCandidateFixture());
    const approved = projectApprovedPreviewArtifactDescriptor(
      createApprovedPreviewArtifactFixture(),
    );

    await internal.saveArtifactMetadata(candidate);
    const saved = await internal.saveArtifactMetadata(approved);

    expect(saved).toEqual(approved);
    expect(Object.isFrozen(saved)).toBe(true);
    expect(await owner.findArtifactMetadataByExecutionId(EXECUTION_ID)).toEqual(approved);
    expect(await other.findArtifactMetadataByArtifactId(approved.artifactId)).toBeNull();
    expect(await admin.findArtifactMetadataByArtifactId(approved.artifactId)).toEqual(approved);
    expect(JSON.stringify(saved)).not.toContain('<!doctype html>');
    await expect(internal.saveArtifactMetadata(candidate)).rejects.toMatchObject({
      code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
    });

    const mismatched = createInMemoryPreviewRepositoryDatabase([executionSeed('f'.repeat(64))]);
    const mismatchedInternal = mismatched.repository({ access: 'INTERNAL' });
    await mismatchedInternal.saveArtifactMetadata(candidate);
    await expect(mismatchedInternal.saveArtifactMetadata(approved)).rejects.toMatchObject({
      code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
    });
  });

  it('aplica owner/admin scope, CAS por revisão, eventos append-only e imutabilidade', async () => {
    const { database, running } = await persistedRunningSession();
    const owner = database.repository({ access: 'OWNER', userId: OWNER_USER_ID });
    const other = database.repository({ access: 'OWNER', userId: OTHER_USER_ID });
    const admin = database.repository({ access: 'GLOBAL_PREVIEW' });
    const resolved = createResolvedPreviewFixture();

    expect(await owner.getByExecutionId(EXECUTION_ID)).toEqual(running);
    expect(await other.getByPreviewId(running.previewId)).toBeNull();
    expect(await admin.getByPreviewId(running.previewId)).toEqual(running);
    expect(Object.isFrozen(running)).toBe(true);
    expect(Object.isFrozen(running.provenance.runtime)).toBe(true);
    expect((await owner.listEvents(running.previewId)).map((event) => event.event)).toEqual([
      'preview.requested',
      'preview.starting',
      'preview.running',
    ]);

    const duplicate = await owner.createOrGet(
      resolved.session,
      createPreviewSessionEvent(resolved.session, 'preview.requested', resolved.session.createdAt),
    );
    expect(duplicate).toEqual({ created: false, session: running });

    const staleStarting = transitionPreviewSession({
      session: resolved.session,
      status: 'STARTING',
      observedAt: '2026-08-10T12:01:01.000Z',
    });
    await expect(
      owner.replace(
        0,
        staleStarting,
        createPreviewSessionEvent(staleStarting, 'preview.starting', '2026-08-10T12:01:01.000Z'),
      ),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
  });

  it('consome tickets uma vez e permite novo View Build após consumo ou revogação', async () => {
    const { database, running } = await persistedRunningSession();
    const owner = database.repository({ access: 'OWNER', userId: OWNER_USER_ID });
    const other = database.repository({ access: 'OWNER', userId: OTHER_USER_ID });
    const gateway = database.repository({ access: 'TICKET_REDEEM' });
    const first = {
      previewId: running.previewId,
      ticketHash: '1'.repeat(64),
      issuedAt: '2026-08-10T12:02:00.000Z',
      expiresAt: '2026-08-10T12:03:00.000Z',
    } as const;

    const issued = await owner.issueAccessTicket(first);
    expect(issued).toEqual({
      previewId: running.previewId,
      issuedAt: first.issuedAt,
      expiresAt: first.expiresAt,
      consumedAt: null,
      revokedAt: null,
    });
    expect(JSON.stringify(issued)).not.toContain(first.ticketHash);
    expect(await owner.issueAccessTicket(first)).toEqual(issued);
    await expect(
      owner.issueAccessTicket({
        ...first,
        ticketHash: '2'.repeat(64),
        issuedAt: '2026-08-10T12:02:05.000Z',
      }),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
    await expect(other.issueAccessTicket(first)).rejects.toMatchObject({
      code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
    });

    const redemption = await gateway.consumeAccessTicket({
      ticketHash: first.ticketHash,
      consumedAt: '2026-08-10T12:02:10.000Z',
    });
    expect(redemption).toEqual({
      previewId: running.previewId,
      executionId: EXECUTION_ID,
      ownerUserId: OWNER_USER_ID,
      expiresAt: first.expiresAt,
    });
    expect(Object.isFrozen(redemption)).toBe(true);
    expect(
      await gateway.consumeAccessTicket({
        ticketHash: first.ticketHash,
        consumedAt: '2026-08-10T12:02:11.000Z',
      }),
    ).toBeNull();

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
    expect(
      await gateway.consumeAccessTicket({
        ticketHash: first.ticketHash,
        consumedAt: '2026-08-10T12:02:21.000Z',
      }),
    ).toBeNull();
    await owner.revokeAccessTicket({
      previewId: running.previewId,
      revokedAt: '2026-08-10T12:02:25.000Z',
    });
    const third = {
      previewId: running.previewId,
      ticketHash: '3'.repeat(64),
      issuedAt: '2026-08-10T12:02:30.000Z',
      expiresAt: '2026-08-10T12:03:30.000Z',
    } as const;
    expect(await owner.issueAccessTicket(third)).toMatchObject({
      consumedAt: null,
      revokedAt: null,
    });
  });

  it('não conserva failure.message potencialmente derivada de runtime', async () => {
    const database = createInMemoryPreviewRepositoryDatabase([executionSeed()]);
    const internal = database.repository({ access: 'INTERNAL' });
    const owner = database.repository({ access: 'OWNER', userId: OWNER_USER_ID });
    await internal.saveArtifactMetadata(
      projectPreviewArtifactDescriptor(createPreviewArtifactCandidateFixture()),
    );
    await internal.saveArtifactMetadata(
      projectApprovedPreviewArtifactDescriptor(createApprovedPreviewArtifactFixture()),
    );
    const resolved = createResolvedPreviewFixture();
    await owner.createOrGet(
      resolved.session,
      createPreviewSessionEvent(resolved.session, 'preview.requested', resolved.session.createdAt),
    );
    const failed = transitionPreviewSession({
      session: resolved.session,
      status: 'FAILED',
      observedAt: '2026-08-10T12:01:01.000Z',
      failure: {
        code: PREVIEW_RUNNER_ERROR_CODES.START_FAILED,
        stage: PREVIEW_RUNNER_ERROR_STAGES.START,
        sourceCode: '/private/runtime/secret-path',
        message: 'raw stderr at /private/runtime/secret-path',
      },
    });
    const stored = await owner.replace(
      resolved.session.revision,
      failed,
      createPreviewSessionEvent(failed, 'preview.failed', '2026-08-10T12:01:01.000Z'),
    );

    expect(stored.failure).toMatchObject({
      code: PREVIEW_RUNNER_ERROR_CODES.START_FAILED,
      stage: PREVIEW_RUNNER_ERROR_STAGES.START,
      sourceCode: '_private_runtime_secret-path',
      message: 'A sessão de Preview falhou.',
    });
    expect(JSON.stringify(stored)).not.toContain('/private/runtime/secret-path');
  });
});
