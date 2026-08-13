import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ExecutionTechnicalResumeClientError,
  getExecutionTechnicalResumeState,
  resumeExecutionTechnicalPipeline,
} from '@/api/execution-technical-resume-client';

import { TechnicalResumeControl } from './technical-resume-control';

vi.mock('@/api/execution-technical-resume-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/execution-technical-resume-client')>();
  return {
    ...original,
    getExecutionTechnicalResumeState: vi.fn(),
    resumeExecutionTechnicalPipeline: vi.fn(),
  };
});

const resumeMock = vi.mocked(resumeExecutionTechnicalPipeline);
const getStateMock = vi.mocked(getExecutionTechnicalResumeState);
const SOURCE_ID = `execution-${'a'.repeat(32)}`;
const RESULT = {
  attemptId: 'technical-resume-4fbd475c-ced4-47ed-aad5-82a772ea75cd',
  sourceExecutionId: SOURCE_ID,
  checkpointHash: '1'.repeat(64),
  status: 'SUCCESS' as const,
  resultHash: '2'.repeat(64),
  usesOpenAI: false as const,
};
const AVAILABLE_STATE = {
  sourceExecutionId: SOURCE_ID,
  checkpointStatus: 'AVAILABLE' as const,
  attempt: null,
};

beforeEach(() => {
  resumeMock.mockReset();
  getStateMock.mockReset();
  getStateMock.mockResolvedValue(AVAILABLE_STATE);
});
afterEach(cleanup);

describe('TechnicalResumeControl', () => {
  it('is available only after an eligible persisted checkpoint is confirmed', async () => {
    const view = render(<TechnicalResumeControl executionId={SOURCE_ID} eligible />);
    expect(screen.queryByRole('button', { name: 'Resume without AI' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Resume without AI' })).toBeVisible();
    expect(screen.getByText(/original result remains immutable/i)).toBeVisible();
    view.rerender(<TechnicalResumeControl executionId={SOURCE_ID} eligible={false} />);
    expect(screen.queryByRole('button', { name: 'Resume without AI' })).not.toBeInTheDocument();
  });

  it('reports the physical attempt and zero OpenAI without rewriting the source', async () => {
    resumeMock.mockResolvedValueOnce(RESULT);
    getStateMock.mockResolvedValueOnce(AVAILABLE_STATE).mockResolvedValueOnce({
      ...AVAILABLE_STATE,
      attempt: {
        attemptId: RESULT.attemptId,
        checkpointHash: RESULT.checkpointHash,
        status: 'SUCCESS',
        activePhase: null,
        startedAt: '2026-08-13T10:00:00.000Z',
        finishedAt: '2026-08-13T10:00:10.000Z',
        resultHash: RESULT.resultHash,
        reasonCode: null,
        cleanupConfirmed: true,
        usesOpenAI: false,
      },
    });
    render(<TechnicalResumeControl executionId={SOURCE_ID} eligible />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resume without AI' }));
    expect(screen.getByRole('button', { name: 'Running technical checks…' })).toBeDisabled();
    expect(await screen.findByRole('status')).toHaveTextContent('OpenAI used: no');
    expect(screen.getByRole('status')).toHaveTextContent(RESULT.attemptId);
    expect(resumeMock).toHaveBeenCalledWith(SOURCE_ID, { signal: expect.any(AbortSignal) });
  });

  it('blocks a second attempt when POST returns a durably journaled pending completion', async () => {
    resumeMock.mockResolvedValueOnce({ ...RESULT, status: 'COMPLETION_PENDING' });
    getStateMock.mockResolvedValueOnce(AVAILABLE_STATE).mockResolvedValueOnce({
      ...AVAILABLE_STATE,
      attempt: {
        attemptId: RESULT.attemptId,
        checkpointHash: RESULT.checkpointHash,
        status: 'RUNNING',
        activePhase: 'COMPLETION_PENDING',
        startedAt: '2026-08-13T10:00:00.000Z',
        finishedAt: null,
        resultHash: null,
        reasonCode: null,
        cleanupConfirmed: false,
        usesOpenAI: false,
      },
    });

    render(<TechnicalResumeControl executionId={SOURCE_ID} eligible />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resume without AI' }));

    expect(
      await screen.findByText(/result was durably recorded.*Final confirmation is pending/iu),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Resume without AI' })).toBeDisabled();
    expect(resumeMock).toHaveBeenCalledTimes(1);
  });

  it('uses terminal persisted state when a pending POST is reconciled before the GET', async () => {
    resumeMock.mockResolvedValueOnce({ ...RESULT, status: 'COMPLETION_PENDING' });
    getStateMock.mockResolvedValueOnce(AVAILABLE_STATE).mockResolvedValueOnce({
      ...AVAILABLE_STATE,
      attempt: {
        attemptId: RESULT.attemptId,
        checkpointHash: RESULT.checkpointHash,
        status: 'SUCCESS',
        activePhase: null,
        startedAt: '2026-08-13T10:00:00.000Z',
        finishedAt: '2026-08-13T10:00:10.000Z',
        resultHash: RESULT.resultHash,
        reasonCode: null,
        cleanupConfirmed: true,
        usesOpenAI: false,
      },
    });

    render(<TechnicalResumeControl executionId={SOURCE_ID} eligible />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resume without AI' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Technical attempt success');
    expect(screen.queryByText(/Final confirmation is pending/iu)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume without AI' })).toBeDisabled();
  });

  it('renders the safe checkpoint reason code and permits another attempt', async () => {
    resumeMock.mockRejectedValueOnce(
      new ExecutionTechnicalResumeClientError(
        'The saved profile no longer matches.',
        'EXECUTION_TECHNICAL_PROFILE_DRIFT',
      ),
    );
    render(<TechnicalResumeControl executionId={SOURCE_ID} eligible />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resume without AI' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('EXECUTION_TECHNICAL_PROFILE_DRIFT'),
    );
    expect(screen.getByRole('button', { name: 'Resume without AI' })).toBeEnabled();
  });

  it('restores the latest owner-scoped attempt after a page reload', async () => {
    getStateMock.mockResolvedValueOnce({
      ...AVAILABLE_STATE,
      attempt: {
        attemptId: RESULT.attemptId,
        checkpointHash: RESULT.checkpointHash,
        status: 'FAILED',
        activePhase: null,
        startedAt: '2026-08-13T10:00:00.000Z',
        finishedAt: '2026-08-13T10:00:10.000Z',
        resultHash: null,
        reasonCode: 'CHECKPOINT_SANDBOX_DRIFT',
        cleanupConfirmed: true,
        usesOpenAI: false,
      },
    });

    render(<TechnicalResumeControl executionId={SOURCE_ID} eligible />);

    expect(await screen.findByRole('alert')).toHaveTextContent('OpenAI used: no');
    expect(screen.getByRole('alert')).toHaveTextContent('CHECKPOINT_SANDBOX_DRIFT');
    expect(getStateMock).toHaveBeenCalledWith(SOURCE_ID, {
      signal: expect.any(AbortSignal),
    });
  });

  it('blocks another attempt when the latest cleanup was not confirmed', async () => {
    getStateMock.mockResolvedValueOnce({
      ...AVAILABLE_STATE,
      attempt: {
        attemptId: RESULT.attemptId,
        checkpointHash: RESULT.checkpointHash,
        status: 'FAILED',
        activePhase: null,
        startedAt: '2026-08-13T10:00:00.000Z',
        finishedAt: '2026-08-13T10:00:10.000Z',
        resultHash: null,
        reasonCode: 'TECHNICAL_RESUME_INTERNAL_ERROR',
        cleanupConfirmed: false,
        usesOpenAI: false,
      },
    });

    render(<TechnicalResumeControl executionId={SOURCE_ID} eligible />);

    expect(
      await screen.findByText(/Cleanup was not confirmed for the latest technical attempt/u),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume without AI' })).toBeDisabled();
  });

  it('shows the safe recovery reason and keeps resume blocked', async () => {
    getStateMock.mockResolvedValueOnce({
      ...AVAILABLE_STATE,
      attempt: {
        attemptId: RESULT.attemptId,
        checkpointHash: RESULT.checkpointHash,
        status: 'RUNNING',
        activePhase: 'RECOVERY_REQUIRED',
        startedAt: '2026-08-13T10:00:00.000Z',
        finishedAt: null,
        resultHash: null,
        reasonCode: 'TECHNICAL_LEASE_EXPIRED',
        cleanupConfirmed: false,
        usesOpenAI: false,
      },
    });

    render(<TechnicalResumeControl executionId={SOURCE_ID} eligible />);

    expect(
      await screen.findByText(/requires safe recovery before another attempt can start/iu),
    ).toBeVisible();
    expect(screen.getAllByText('TECHNICAL_LEASE_EXPIRED')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Resume without AI' })).toBeDisabled();
  });

  it('shows an executing lease as active without exposing lease metadata', async () => {
    getStateMock.mockResolvedValueOnce({
      ...AVAILABLE_STATE,
      attempt: {
        attemptId: RESULT.attemptId,
        checkpointHash: RESULT.checkpointHash,
        status: 'RUNNING',
        activePhase: 'EXECUTING',
        startedAt: '2026-08-13T10:00:00.000Z',
        finishedAt: null,
        resultHash: null,
        reasonCode: null,
        cleanupConfirmed: false,
        usesOpenAI: false,
      },
    });

    render(<TechnicalResumeControl executionId={SOURCE_ID} eligible />);

    expect(await screen.findByText(/A technical attempt is active/iu)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Resume without AI' })).toBeDisabled();
    expect(document.body).not.toHaveTextContent(/heartbeat|lease expires|lease id/iu);
  });

  it('does not offer resume when the persisted checkpoint does not exist', async () => {
    getStateMock.mockResolvedValueOnce({
      ...AVAILABLE_STATE,
      checkpointStatus: 'NOT_FOUND',
    });

    render(<TechnicalResumeControl executionId={SOURCE_ID} eligible />);

    await waitFor(() => expect(getStateMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Resume without AI' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Resume the technical pipeline/u)).not.toBeInTheDocument();
  });

  it.each([
    ['CLEANUP_PENDING' as const, /Cleanup confirmation.*still pending/u],
    ['CLEANUP_FAILED' as const, /Cleanup failed for the source execution/u],
  ])('shows and blocks the persisted %s state', async (checkpointStatus, message) => {
    getStateMock.mockResolvedValueOnce({ ...AVAILABLE_STATE, checkpointStatus });

    render(<TechnicalResumeControl executionId={SOURCE_ID} eligible />);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume without AI' })).toBeDisabled();
  });

  it('refreshes persisted state after POST and blocks an unclean attempt without reload', async () => {
    resumeMock.mockResolvedValueOnce({ ...RESULT, status: 'FAILED' });
    getStateMock.mockResolvedValueOnce(AVAILABLE_STATE).mockResolvedValueOnce({
      ...AVAILABLE_STATE,
      attempt: {
        attemptId: RESULT.attemptId,
        checkpointHash: RESULT.checkpointHash,
        status: 'FAILED',
        activePhase: null,
        startedAt: '2026-08-13T10:00:00.000Z',
        finishedAt: '2026-08-13T10:00:10.000Z',
        resultHash: RESULT.resultHash,
        reasonCode: 'WORKSPACE_RELEASE_FAILED',
        cleanupConfirmed: false,
        usesOpenAI: false,
      },
    });
    render(<TechnicalResumeControl executionId={SOURCE_ID} eligible />);

    fireEvent.click(await screen.findByRole('button', { name: 'Resume without AI' }));

    expect(
      await screen.findByText(/Cleanup was not confirmed for the latest technical attempt/u),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume without AI' })).toBeDisabled();
    expect(getStateMock).toHaveBeenCalledTimes(2);
  });
});
