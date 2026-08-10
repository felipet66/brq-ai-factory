import { describe, expect, it } from 'vitest';

import { PREVIEW_RUNNER_ERROR_CODES } from './errors';
import { createInMemoryPreviewSessionStore } from './in-memory-store';
import { previewSessionSchema } from './schemas';
import { createPreviewSessionEvent, transitionPreviewSession } from './session';
import {
  createRunningPreviewSessionFixture,
  createResolvedPreviewFixture,
} from './testing/preview-runner-fixtures';

describe('InMemoryPreviewSessionStore', () => {
  it('preserves one lifecycle per execution with optimistic revisions and immutable events', async () => {
    const store = createInMemoryPreviewSessionStore();
    const { session } = createResolvedPreviewFixture();
    const requested = createPreviewSessionEvent(session, 'preview.requested', session.createdAt);
    expect((await store.createOrGet(session, requested)).created).toBe(true);
    expect((await store.createOrGet(session, requested)).created).toBe(false);
    const starting = transitionPreviewSession({
      session,
      status: 'STARTING',
      observedAt: '2026-08-10T12:01:01.000Z',
    });
    await store.replace(
      session.revision,
      starting,
      createPreviewSessionEvent(starting, 'preview.starting', '2026-08-10T12:01:01.000Z'),
    );
    await expect(
      store.replace(
        session.revision,
        starting,
        createPreviewSessionEvent(starting, 'preview.starting', '2026-08-10T12:01:01.000Z'),
      ),
    ).rejects.toMatchObject({ code: PREVIEW_RUNNER_ERROR_CODES.CONFLICT });
    expect(await store.getByExecutionId(session.executionId)).toEqual(starting);
    expect(await store.getByPreviewId(session.previewId)).toEqual(starting);
    const events = await store.listEvents(session.previewId);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(Object.isFrozen(events)).toBe(true);
  });

  it('rejects non-canonical creation and event correlation drift', async () => {
    const { session } = createResolvedPreviewFixture();
    const starting = transitionPreviewSession({
      session,
      status: 'STARTING',
      observedAt: '2026-08-10T12:01:01.000Z',
    });
    const store = createInMemoryPreviewSessionStore();

    await expect(
      store.createOrGet(
        starting,
        createPreviewSessionEvent(starting, 'preview.starting', '2026-08-10T12:01:01.000Z'),
      ),
    ).rejects.toMatchObject({ code: PREVIEW_RUNNER_ERROR_CODES.CONFLICT });

    const requested = createPreviewSessionEvent(session, 'preview.requested', session.createdAt);
    await expect(
      store.createOrGet(session, { ...requested, executionId: 'execution-divergent' }),
    ).rejects.toMatchObject({ code: PREVIEW_RUNNER_ERROR_CODES.CONFLICT });
  });

  it('rejects illegal transitions, immutable identity changes and revision event drift', async () => {
    const store = createInMemoryPreviewSessionStore();
    const { session } = createResolvedPreviewFixture();
    await store.createOrGet(
      session,
      createPreviewSessionEvent(session, 'preview.requested', session.createdAt),
    );

    const running = createRunningPreviewSessionFixture();
    const illegalRunning = previewSessionSchema.parse({ ...running, revision: 1 });
    await expect(
      store.replace(
        session.revision,
        illegalRunning,
        createPreviewSessionEvent(illegalRunning, 'preview.running', illegalRunning.startedAt!),
      ),
    ).rejects.toMatchObject({ code: PREVIEW_RUNNER_ERROR_CODES.CONFLICT });

    const starting = transitionPreviewSession({
      session,
      status: 'STARTING',
      observedAt: '2026-08-10T12:01:01.000Z',
    });
    const identityDrift = previewSessionSchema.parse({
      ...starting,
      expiresAt: new Date(Date.parse(starting.expiresAt) - 1000).toISOString(),
    });
    await expect(
      store.replace(
        session.revision,
        identityDrift,
        createPreviewSessionEvent(identityDrift, 'preview.starting', '2026-08-10T12:01:01.000Z'),
      ),
    ).rejects.toMatchObject({ code: PREVIEW_RUNNER_ERROR_CODES.CONFLICT });

    const startingEvent = createPreviewSessionEvent(
      starting,
      'preview.starting',
      '2026-08-10T12:01:01.000Z',
    );
    await expect(
      store.replace(session.revision, starting, { ...startingEvent, sequence: 3 }),
    ).rejects.toMatchObject({ code: PREVIEW_RUNNER_ERROR_CODES.CONFLICT });
  });
});
