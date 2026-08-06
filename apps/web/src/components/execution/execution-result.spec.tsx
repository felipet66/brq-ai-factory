import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ExecutionSummary } from '@/api/execution-contracts';

import { ExecutionResult } from './execution-result';

afterEach(cleanup);

function summary(overrides: Partial<ExecutionSummary> = {}): ExecutionSummary {
  return {
    executionId: `execution-${'a'.repeat(32)}`,
    status: 'SUCCESS',
    durationMs: 42,
    readiness: 'READY',
    hashes: {
      executionRequestHash: '1'.repeat(64),
      workflowRequestHash: '2'.repeat(64),
      workflowHash: '3'.repeat(64),
      lineageHash: '4'.repeat(64),
      provenanceHash: '5'.repeat(64),
      executionHash: '6'.repeat(64),
    },
    lineage: { outputCount: 3, verifiedHandoffs: 3 },
    provenance: {
      stages: [
        {
          stage: 'PRODUCT_OWNER',
          agentVersion: '1.0.0',
          outcome: 'GENERATED',
          readiness: 'READY',
        },
        {
          stage: 'DEVELOPER',
          agentVersion: '1.0.0',
          outcome: 'GENERATED',
          readiness: 'READY',
        },
        {
          stage: 'QA',
          agentVersion: '1.0.0',
          outcome: 'GENERATED',
          readiness: 'READY',
        },
      ],
    },
    ...overrides,
  };
}

describe('ExecutionResult', () => {
  it('renders the permitted execution summary fields', () => {
    render(<ExecutionResult result={summary()} />);

    expect(screen.getByText(`execution-${'a'.repeat(32)}`)).toBeInTheDocument();
    expect(screen.getByText('SUCCESS')).toBeInTheDocument();
    expect(screen.getByText('42 ms')).toBeInTheDocument();
    expect(screen.getAllByText('READY').length).toBeGreaterThan(0);
    expect(screen.getByText('3'.repeat(64))).toBeInTheDocument();

    const lineage = screen.getByRole('heading', { name: 'Lineage summary' }).parentElement;
    expect(lineage).not.toBeNull();
    if (lineage === null) throw new Error('Lineage section was not rendered.');
    expect(within(lineage).getAllByText('3')).toHaveLength(2);
    expect(screen.getByText('PRODUCT_OWNER')).toBeInTheDocument();
    expect(screen.getByText('DEVELOPER')).toBeInTheDocument();
    expect(screen.getByText('QA')).toBeInTheDocument();
  });

  it('keeps functional failures in the result view and handles absent summaries', () => {
    render(
      <ExecutionResult
        result={summary({
          status: 'FAILED',
          readiness: null,
          lineage: null,
          provenance: null,
          hashes: {
            ...summary().hashes,
            workflowHash: null,
            lineageHash: null,
            provenanceHash: null,
          },
        })}
      />,
    );

    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not available for this execution.')).toHaveLength(2);
  });
});
