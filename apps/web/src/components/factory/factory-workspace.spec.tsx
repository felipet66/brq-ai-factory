import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFactoryViewModel } from './factory-view-model';
import {
  factoryExecutionFixture,
  factoryTimelineFixture,
} from './factory-view-model.spec.fixtures';
import { FactoryWorkspace } from './factory-workspace';

afterEach(cleanup);

describe('FactoryWorkspace', () => {
  it('renders a connected production line from the immutable FactoryViewModel', () => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: factoryTimelineFixture(),
    });
    const { container } = render(
      <FactoryWorkspace model={model} canAccessPlayground updateError={null} onReload={vi.fn()} />,
    );

    expect(screen.getByRole('region', { name: 'AI Software Factory control room' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Factory progress' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Knowledge system preflight' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Factory Floor' })).toBeVisible();
    expect(screen.getByRole('list', { name: 'Agent production line' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /station,/ })).toHaveLength(3);
    expect(screen.getByRole('img', { name: 'Product Owner visual state: SUCCESS' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Developer visual state: SUCCESS' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'QA visual state: SUCCESS' })).toBeVisible();
    expect(screen.getByRole('group', { name: /PRODUCT_OWNER to DEVELOPER handoff/ })).toBeVisible();
    expect(screen.getByRole('group', { name: /DEVELOPER to QA handoff/ })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Live activity' })).toBeVisible();
    expect(screen.getByText('Execution queued')).toBeVisible();
    expect(screen.getByText('Knowledge loaded')).toBeVisible();
    expect(screen.getAllByText('RECORDED')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Playground' })).toHaveAttribute('href', '/playground');

    const productionLine = screen.getByRole('list', { name: 'Agent production line' });
    expect(within(productionLine).getAllByRole('listitem')).toHaveLength(5);
    expect(container).not.toHaveTextContent('story.md');
    expect(container).not.toHaveTextContent('architecture.md');
    expect(container).not.toHaveTextContent('test-plan.md');
  });

  it('selects stations with pointer and arrow-key navigation', () => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: factoryTimelineFixture(),
    });
    render(
      <FactoryWorkspace
        model={model}
        canAccessPlayground={false}
        updateError={null}
        onReload={vi.fn()}
      />,
    );

    const productOwner = screen.getByRole('button', { name: /Product Owner station/ });
    const developer = screen.getByRole('button', { name: /Developer station/ });
    productOwner.focus();
    fireEvent.keyDown(productOwner, { key: 'ArrowRight' });

    expect(developer).toHaveFocus();
    expect(developer).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { level: 3, name: 'Developer' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /QA station/ }));
    expect(screen.getByRole('heading', { level: 3, name: 'QA' })).toBeVisible();
    expect(screen.getByText(/Supplemental handoff/)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Playground' })).not.toBeInTheDocument();
  });

  it('keeps the latest verified state visible when polling stops', () => {
    const reload = vi.fn();
    const model = createFactoryViewModel({
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
      timeline: factoryTimelineFixture({
        status: 'RUNNING',
        summary: null,
        stages: factoryTimelineFixture().stages.map((stage) =>
          stage.stageId === 'DEVELOPER'
            ? { ...stage, status: 'RUNNING', finishedAt: null, durationMs: null }
            : stage.stageId === 'QA'
              ? {
                  ...stage,
                  status: 'PENDING',
                  startedAt: null,
                  finishedAt: null,
                  durationMs: null,
                }
              : stage,
        ),
      }),
    });
    render(
      <FactoryWorkspace
        model={model}
        canAccessPlayground={false}
        updateError="Live updates are unavailable."
        onReload={reload}
      />,
    );

    expect(screen.getByRole('button', { name: /Developer station, WORKING/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /QA station, WAITING/ })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Product Owner visual state: HANDOFF' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Developer visual state: WORKING' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'QA visual state: WAITING' })).toBeVisible();
    expect(screen.getByText(/last verified factory state remains visible/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reload live data' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('renders functional failure and skipped downstream work without inventing activity', () => {
    const baseExecution = factoryExecutionFixture();
    const baseTimeline = factoryTimelineFixture();
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        readiness: null,
        job: { ...baseExecution.job!, status: 'FAILED' },
        lineage: {
          outputs: {
            productOwnerSpecificationHash:
              baseExecution.lineage!.outputs.productOwnerSpecificationHash,
            technicalSpecificationHash: null,
            qaSpecificationHash: null,
          },
          handoffs: [baseExecution.lineage!.handoffs[0]!],
        },
        provenance: {
          stages: [
            baseExecution.provenance!.stages[0]!,
            {
              ...baseExecution.provenance!.stages[1]!,
              outcome: 'VALIDATION_REJECTED',
              readiness: null,
              hashes: {
                ...baseExecution.provenance!.stages[1]!.hashes,
                generationHash: null,
                artifactHashes: [],
              },
            },
          ],
        },
      }),
      timeline: factoryTimelineFixture({
        status: 'FAILED',
        stages: baseTimeline.stages.map((stage) =>
          stage.stageId === 'DEVELOPER'
            ? { ...stage, status: 'FAILED' }
            : stage.stageId === 'QA'
              ? {
                  ...stage,
                  status: 'SKIPPED',
                  startedAt: null,
                  finishedAt: baseTimeline.updatedAt,
                  durationMs: null,
                }
              : stage,
        ),
        summary: {
          ...baseTimeline.summary!,
          workflowStatus: 'FAILED',
          readinessFinal: null,
          skippedStages: ['QA'],
        },
      }),
    });
    render(
      <FactoryWorkspace
        model={model}
        canAccessPlayground={false}
        updateError={null}
        onReload={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Developer station, FAILED/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /QA station, SKIPPED/ })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Developer visual state: ERROR' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'QA visual state: SKIPPED' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Developer station, FAILED/ }));
    expect(screen.getByText('VALIDATION_REJECTED')).toBeVisible();
    expect(screen.queryByText(/analyzing|thinking|reasoning/i)).not.toBeInTheDocument();
  });
});
