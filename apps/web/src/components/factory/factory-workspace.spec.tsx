import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFactoryViewModel } from './factory-view-model';
import {
  factoryExecutionFixture,
  factoryResultFixture,
  factoryTimelineFixture,
  factoryTimelineV2Fixture,
} from './factory-view-model.spec.fixtures';
import { FactoryWorkspace } from './factory-workspace';

vi.mock('./preview-control', () => ({
  PreviewControl: ({ factoryApproved }: { readonly factoryApproved: boolean }) => (
    <section aria-label="preview control">{factoryApproved ? 'APPROVED' : 'UNAVAILABLE'}</section>
  ),
}));
vi.mock('./execution-rerun-control', () => ({
  ExecutionRerunControl: ({ eligible }: { readonly eligible: boolean }) =>
    eligible ? <section aria-label="cache-only rerun">ELIGIBLE</section> : null,
}));
vi.mock('./technical-resume-control', () => ({
  TechnicalResumeControl: ({ eligible }: { readonly eligible: boolean }) =>
    eligible ? <section aria-label="technical resume">ELIGIBLE</section> : null,
}));

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
    expect(screen.getByRole('heading', { name: 'Code to verified workspace' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'preview control' })).toHaveTextContent(
      'UNAVAILABLE',
    );
    expect(screen.getByText(/No Factory Pipeline evidence/)).toBeVisible();
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

  it('renders the evidence-backed technical production rail without source or command output', () => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({ factoryResult: factoryResultFixture() }),
      timeline: factoryTimelineV2Fixture(),
    });
    const { container } = render(
      <FactoryWorkspace
        model={model}
        canAccessPlayground={false}
        updateError={null}
        onReload={vi.fn()}
      />,
    );

    const pipeline = screen.getByRole('list', { name: 'Factory technical pipeline' });
    expect(within(pipeline).getAllByRole('listitem')).toHaveLength(7);
    expect(within(pipeline).getByText('Code Generator')).toBeVisible();
    expect(within(pipeline).getByText('Profile Validation')).toBeVisible();
    expect(within(pipeline).getByText('Controlled Workspace')).toBeVisible();
    expect(within(pipeline).getByText('Typecheck')).toBeVisible();
    expect(within(pipeline).getByText('Build')).toBeVisible();
    expect(within(pipeline).getByText('Test')).toBeVisible();
    expect(within(pipeline).getByText('RELEASED')).toBeVisible();
    expect(screen.getByRole('region', { name: 'preview control' })).toHaveTextContent('APPROVED');
    expect(container).not.toHaveTextContent('stdout');
    expect(container).not.toHaveTextContent('stderr');
    expect(container).not.toHaveTextContent('containerId');
    expect(container).not.toHaveTextContent('console.log');
  });

  it('offers cache-only rerun after Code Generator succeeded and a downstream stage failed', () => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        factoryResult: factoryResultFixture({ status: 'FAILED' }),
      }),
      timeline: factoryTimelineV2Fixture({ status: 'FAILED' }),
    });

    render(
      <FactoryWorkspace
        model={model}
        canAccessPlayground={false}
        updateError={null}
        onReload={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: 'cache-only rerun' })).toHaveTextContent('ELIGIBLE');
    expect(screen.getByRole('region', { name: 'technical resume' })).toHaveTextContent('ELIGIBLE');
  });

  it('does not offer rerun when Code Generator did not succeed', () => {
    const successful = factoryResultFixture();
    const timeline = factoryTimelineV2Fixture();
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        factoryResult: factoryResultFixture({
          status: 'FAILED',
          stages: successful.stages.map((stage) =>
            stage.stageId === 'CODE_GENERATOR' ? { ...stage, status: 'FAILED' } : stage,
          ),
        }),
      }),
      timeline: factoryTimelineV2Fixture({
        status: 'FAILED',
        stages: timeline.stages.map((stage) =>
          stage.stageId === 'CODE_GENERATOR' ? { ...stage, status: 'FAILED' } : stage,
        ),
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

    expect(screen.queryByRole('region', { name: 'cache-only rerun' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'technical resume' })).not.toBeInTheDocument();
  });

  it('does not offer technical resume until Profile Validation succeeded', () => {
    const successful = factoryResultFixture();
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        factoryResult: factoryResultFixture({
          status: 'FAILED',
          stages: successful.stages.map((stage) =>
            stage.stageId === 'CODE_PROFILE_VALIDATION'
              ? { ...stage, status: 'FAILED', failureCode: 'PROFILE_INCOMPATIBLE' }
              : stage,
          ),
        }),
      }),
      timeline: factoryTimelineV2Fixture({ status: 'FAILED' }),
    });

    render(
      <FactoryWorkspace
        model={model}
        canAccessPlayground={false}
        updateError={null}
        onReload={vi.fn()}
      />,
    );

    expect(screen.queryByRole('region', { name: 'technical resume' })).not.toBeInTheDocument();
  });

  it('renders a safe Sandbox reason separately from its stable failure code', () => {
    const successful = factoryResultFixture();
    const factoryResult = factoryResultFixture({
      status: 'FAILED',
      terminalStage: 'SANDBOX_PREPARE',
      sandboxStatus: 'FAILED',
      failure: {
        kind: 'FACTORY_PIPELINE',
        code: 'SANDBOX_STEP_FAILED',
        sourceCode: null,
        reasonCode: 'INLINE_ACTIVE_CONTENT',
        profileRuleId: null,
        diagnosticSummary: null,
        stageId: 'SANDBOX_PREPARE',
      },
      stages: successful.stages.map((stage) =>
        stage.stageId === 'SANDBOX_PREPARE'
          ? {
              ...stage,
              status: 'FAILED',
              failureCode: 'SANDBOX_STEP_FAILED',
              reasonCode: 'INLINE_ACTIVE_CONTENT',
            }
          : stage,
      ),
    });
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({ status: 'FAILED', factoryResult }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });
    const { container } = render(
      <FactoryWorkspace
        model={model}
        canAccessPlayground={false}
        updateError={null}
        onReload={vi.fn()}
      />,
    );
    const pipeline = screen.getByRole('list', { name: 'Factory technical pipeline' });

    expect(within(pipeline).getByText('Failure')).toBeVisible();
    expect(within(pipeline).getByText('SANDBOX_STEP_FAILED')).toBeVisible();
    expect(within(pipeline).getByText('Reason')).toBeVisible();
    expect(within(pipeline).getByText('INLINE_ACTIVE_CONTENT')).toBeVisible();
    expect(container).not.toHaveTextContent('EXIT_1');
    expect(container).not.toHaveTextContent('stderr');
  });

  it('renders only the safe TypeScript diagnostic count and codes', () => {
    const successful = factoryResultFixture();
    const diagnosticSummary = {
      diagnosticCount: 3,
      diagnosticCodes: [2307, 2322],
      truncated: true,
    } as const;
    const factoryResult = factoryResultFixture({
      status: 'FAILED',
      terminalStage: 'SANDBOX_TYPECHECK',
      sandboxStatus: 'FAILED',
      failure: {
        kind: 'FACTORY_PIPELINE',
        code: 'SANDBOX_STEP_FAILED',
        sourceCode: null,
        reasonCode: 'TYPESCRIPT_DIAGNOSTICS',
        profileRuleId: null,
        diagnosticSummary,
        stageId: 'SANDBOX_TYPECHECK',
      },
      stages: successful.stages.map((stage) =>
        stage.stageId === 'SANDBOX_TYPECHECK'
          ? {
              ...stage,
              status: 'FAILED',
              failureCode: 'SANDBOX_STEP_FAILED',
              reasonCode: 'TYPESCRIPT_DIAGNOSTICS',
              diagnosticSummary,
            }
          : stage,
      ),
    });
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({ status: 'FAILED', factoryResult }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });
    const { container } = render(
      <FactoryWorkspace
        model={model}
        canAccessPlayground={false}
        updateError={null}
        onReload={vi.fn()}
      />,
    );
    const pipeline = screen.getByRole('list', { name: 'Factory technical pipeline' });

    expect(within(pipeline).getByText('TypeScript diagnostics')).toBeVisible();
    expect(within(pipeline).getByText('3 (truncated)')).toBeVisible();
    expect(within(pipeline).getByText('TS2307, TS2322')).toBeVisible();
    expect(container).not.toHaveTextContent('/private/workspace');
    expect(container).not.toHaveTextContent('private source');
  });

  it('shows only the allowlisted rule recorded by failed Profile Validation', () => {
    const successful = factoryResultFixture();
    const profileFailure = {
      kind: 'FACTORY_PIPELINE' as const,
      code: 'FACTORY_PIPELINE_CODE_PROFILE_VALIDATION_FAILED',
      sourceCode: null,
      reasonCode: 'EXTERNAL_OR_UNSAFE_REFERENCE',
      profileRuleId: 'content.javascript.relative-references' as const,
      diagnosticSummary: null,
      stageId: 'CODE_PROFILE_VALIDATION' as const,
    };
    const failedStages = successful.stages.map((stage) =>
      stage.stageId === 'CODE_PROFILE_VALIDATION'
        ? {
            ...stage,
            status: 'FAILED' as const,
            failureCode: profileFailure.code,
            reasonCode: profileFailure.reasonCode,
            profileRuleId: profileFailure.profileRuleId,
          }
        : stage,
    );
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        factoryResult: factoryResultFixture({
          status: 'FAILED',
          terminalStage: 'CODE_PROFILE_VALIDATION',
          failure: profileFailure,
          stages: failedStages,
        }),
      }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });
    const view = render(
      <FactoryWorkspace
        model={model}
        canAccessPlayground={false}
        updateError={null}
        onReload={vi.fn()}
      />,
    );
    const pipeline = screen.getByRole('list', { name: 'Factory technical pipeline' });

    expect(within(pipeline).getByText('Profile rule')).toBeVisible();
    expect(within(pipeline).getByText('content.javascript.relative-references')).toBeVisible();

    const unknownModel = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        factoryResult: factoryResultFixture({
          status: 'FAILED',
          terminalStage: 'CODE_PROFILE_VALIDATION',
          failure: { ...profileFailure, profileRuleId: 'internal.customer.rule' as never },
          stages: failedStages.map((stage) =>
            stage.stageId === 'CODE_PROFILE_VALIDATION'
              ? { ...stage, profileRuleId: 'internal.customer.rule' as never }
              : stage,
          ),
        }),
      }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });
    view.rerender(
      <FactoryWorkspace
        model={unknownModel}
        canAccessPlayground={false}
        updateError={null}
        onReload={vi.fn()}
      />,
    );

    expect(screen.queryByText('Profile rule')).not.toBeInTheDocument();
    expect(view.container).not.toHaveTextContent('internal.customer.rule');
  });

  it('shows the real readiness origin and safe Code Generator source reason', () => {
    const source = factoryExecutionFixture();
    const successfulFactory = factoryResultFixture();
    const qaBlockedFactory = factoryResultFixture({
      status: 'FAILED',
      terminalStage: 'CODE_GENERATOR',
      readiness: 'PARTIALLY_READY',
      generationStatus: 'FAILED',
      failure: {
        kind: 'FACTORY_PIPELINE',
        code: 'FACTORY_PIPELINE_QA_NOT_READY',
        sourceCode: null,
        reasonCode: 'SOURCE_QA_READINESS_NOT_READY',
        profileRuleId: null,
        diagnosticSummary: null,
        stageId: 'CODE_GENERATOR',
      },
      stages: successfulFactory.stages.map((stage) =>
        stage.stageId === 'CODE_GENERATOR'
          ? {
              ...stage,
              status: 'FAILED',
              failureCode: 'FACTORY_PIPELINE_QA_NOT_READY',
              reasonCode: 'SOURCE_QA_READINESS_NOT_READY',
            }
          : stage,
      ),
    });
    const partialModel = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        readiness: 'PARTIALLY_READY',
        provenance: {
          stages: source.provenance!.stages.map((stage) => ({
            ...stage,
            readiness: 'PARTIALLY_READY',
            readinessDecision: {
              version: '1.0.0',
              readiness: 'PARTIALLY_READY',
              decisiveFactors:
                stage.stage === 'PRODUCT_OWNER'
                  ? [
                      {
                        sourceStage: 'PRODUCT_OWNER' as const,
                        code: 'NON_BLOCKING_QUESTION_PRESENT' as const,
                      },
                    ]
                  : stage.stage === 'DEVELOPER'
                    ? [
                        {
                          sourceStage: 'PRODUCT_OWNER' as const,
                          code: 'SOURCE_PARTIALLY_READY' as const,
                        },
                      ]
                    : [
                        {
                          sourceStage: 'DEVELOPER' as const,
                          code: 'SOURCE_PARTIALLY_READY' as const,
                        },
                      ],
            },
          })),
        },
        factoryResult: qaBlockedFactory,
      }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });
    const view = render(
      <FactoryWorkspace
        model={partialModel}
        canAccessPlayground={false}
        updateError={null}
        onReload={vi.fn()}
      />,
    );
    const readinessPath = screen.getByRole('region', { name: 'Readiness path' });

    expect(
      within(readinessPath).getByText('PRODUCT_OWNER · NON_BLOCKING_QUESTION_PRESENT'),
    ).toBeVisible();
    expect(within(readinessPath).getByText('PRODUCT_OWNER · SOURCE_PARTIALLY_READY')).toBeVisible();
    expect(within(readinessPath).getByText('DEVELOPER · SOURCE_PARTIALLY_READY')).toBeVisible();
    expect(within(readinessPath).getByText('Factory blocked before Code Generation')).toBeVisible();
    expect(within(readinessPath).getByText('SOURCE_QA_READINESS_NOT_READY')).toBeVisible();

    const sourceRejectedFactory = factoryResultFixture({
      ...successfulFactory,
      status: 'FAILED',
      terminalStage: 'CODE_GENERATOR',
      generationStatus: 'FAILED',
      failure: {
        kind: 'FACTORY_PIPELINE',
        code: 'FACTORY_PIPELINE_CODE_GENERATION_FAILED',
        sourceCode: null,
        reasonCode: 'SOURCE_CHANGE_TYPE_NOT_CREATE',
        profileRuleId: null,
        diagnosticSummary: null,
        stageId: 'CODE_GENERATOR',
      },
      stages: successfulFactory.stages.map((stage) =>
        stage.stageId === 'CODE_GENERATOR'
          ? {
              ...stage,
              status: 'FAILED',
              failureCode: 'FACTORY_PIPELINE_CODE_GENERATION_FAILED',
              reasonCode: 'SOURCE_CHANGE_TYPE_NOT_CREATE',
            }
          : stage,
      ),
    });
    const sourceRejectedModel = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        factoryResult: sourceRejectedFactory,
      }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });
    view.rerender(
      <FactoryWorkspace
        model={sourceRejectedModel}
        canAccessPlayground={false}
        updateError={null}
        onReload={vi.fn()}
      />,
    );

    expect(screen.getByText('Code Generator rejected source')).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Readiness path' })).getByText(
        'SOURCE_CHANGE_TYPE_NOT_CREATE',
      ),
    ).toBeVisible();
    expect(view.container).not.toHaveTextContent('private source diagnostics');
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
