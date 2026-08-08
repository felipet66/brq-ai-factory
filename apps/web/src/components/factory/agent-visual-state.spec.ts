import { describe, expect, it } from 'vitest';

import { resolveAgentVisualState, type AgentVisualState } from './agent-visual-state';
import { createFactoryViewModel, type FactoryTimelineSource } from './factory-view-model';
import {
  factoryExecutionFixture,
  factoryTimelineFixture,
} from './factory-view-model.spec.fixtures';

function stageTimeline(
  statuses: Partial<
    Record<
      FactoryTimelineSource['stages'][number]['stageId'],
      FactoryTimelineSource['stages'][number]['status']
    >
  >,
): FactoryTimelineSource {
  const timeline = factoryTimelineFixture();
  return {
    ...timeline,
    status: 'RUNNING',
    summary: null,
    stages: timeline.stages.map((stage) => {
      const status = statuses[stage.stageId] ?? stage.status;
      return {
        ...stage,
        status,
        startedAt: status === 'PENDING' || status === 'SKIPPED' ? null : stage.startedAt,
        finishedAt: ['SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(status)
          ? stage.finishedAt
          : null,
        durationMs: ['SUCCESS', 'FAILED', 'CANCELLED'].includes(status) ? stage.durationMs : null,
      };
    }),
  };
}

function runningModel(statuses: Parameters<typeof stageTimeline>[0]) {
  return createFactoryViewModel({
    execution: factoryExecutionFixture({
      status: 'RUNNING',
      finishedAt: null,
      durationMs: null,
      lineage: null,
      provenance: null,
      job: {
        ...factoryExecutionFixture().job!,
        status: 'RUNNING',
        finishedAt: null,
      },
    }),
    timeline: stageTimeline(statuses),
  });
}

describe('resolveAgentVisualState', () => {
  it('uses IDLE while a queued execution has not started any agent stage', () => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'CREATED',
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        job: {
          ...factoryExecutionFixture().job!,
          status: 'QUEUED',
          startedAt: null,
          finishedAt: null,
        },
      }),
      timeline: null,
    });

    expect(resolveAgentVisualState(model, model.agents[0])).toMatchObject({
      state: 'IDLE',
      technicalStatus: 'WAITING',
      badgeLabel: 'IDLE',
      assetPath: '/assets/po/01-idle.png',
      motion: 'STILL',
    });
  });

  it('derives waiting and working visuals only from current timeline stage status', () => {
    const model = runningModel({ DEVELOPER: 'RUNNING', QA: 'PENDING' });

    expect(resolveAgentVisualState(model, model.agents[1])).toMatchObject({
      state: 'WORKING',
      technicalStatus: 'WORKING',
      assetPath: '/assets/developer/03-working.png',
      motion: 'ACTIVE',
    });
    expect(resolveAgentVisualState(model, model.agents[2])).toMatchObject({
      state: 'WAITING',
      technicalStatus: 'WAITING',
      assetPath: '/assets/qa/05-waiting.png',
      motion: 'STILL',
    });
  });

  it('shows an active primary handoff only when its target is observably working', () => {
    const model = runningModel({ PRODUCT_OWNER: 'SUCCESS', DEVELOPER: 'RUNNING', QA: 'PENDING' });
    const productOwner = resolveAgentVisualState(model, model.agents[0]);

    expect(model.handoffs[0].status).toBe('OBSERVED');
    expect(productOwner).toMatchObject({
      state: 'HANDOFF',
      technicalStatus: 'COMPLETED',
      assetPath: '/assets/po/04-handoff.png',
      motion: 'TRANSFER',
    });
    expect(productOwner.microcopy).toContain('handoff to Developer is observed');
  });

  it('does not animate a verified terminal handoff after the target completed', () => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: factoryTimelineFixture(),
    });

    expect(model.handoffs[0].status).toBe('VERIFIED');
    expect(resolveAgentVisualState(model, model.agents[0])).toMatchObject({
      state: 'SUCCESS',
      assetPath: '/assets/po/06-success.png',
      motion: 'TERMINAL',
    });
  });

  it.each<{
    sourceStatus: 'FAILED' | 'CANCELLED' | 'SKIPPED';
    expectedState: AgentVisualState;
    expectedAsset: string;
  }>([
    { sourceStatus: 'FAILED', expectedState: 'ERROR', expectedAsset: '07-error.png' },
    { sourceStatus: 'CANCELLED', expectedState: 'CANCELLED', expectedAsset: '07-error.png' },
    { sourceStatus: 'SKIPPED', expectedState: 'SKIPPED', expectedAsset: '01-idle.png' },
  ])(
    'keeps $sourceStatus distinct as $expectedState without inventing another phase',
    ({ sourceStatus, expectedState, expectedAsset }) => {
      const model = runningModel({ QA: sourceStatus });
      const presentation = resolveAgentVisualState(model, model.agents[2]);

      expect(presentation).toMatchObject({
        state: expectedState,
        technicalStatus: sourceStatus === 'FAILED' ? 'FAILED' : sourceStatus,
        assetPath: `/assets/qa/${expectedAsset}`,
      });
      expect(presentation.assetPath).not.toContain('02-analyzing');
    },
  );

  it('represents missing terminal timeline evidence as NOT_OBSERVED', () => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: null,
    });
    const presentation = resolveAgentVisualState(model, model.agents[1]);

    expect(presentation).toMatchObject({
      state: 'NOT_OBSERVED',
      technicalStatus: 'NOT_OBSERVED',
      badgeLabel: 'NOT OBSERVED',
      assetPath: '/assets/developer/01-idle.png',
      motion: 'MUTED',
    });
    expect(presentation.microcopy).toBe(
      'No timeline evidence is available for the Developer stage.',
    );
  });

  it('returns a frozen presentation and never selects the reserved analyzing asset', () => {
    const model = runningModel({ PRODUCT_OWNER: 'RUNNING', DEVELOPER: 'PENDING', QA: 'PENDING' });

    for (const agent of model.agents) {
      const presentation = resolveAgentVisualState(model, agent);
      expect(Object.isFrozen(presentation)).toBe(true);
      expect(presentation.assetPath).not.toContain('02-analyzing');
    }
  });
});
