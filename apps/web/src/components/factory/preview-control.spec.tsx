import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreviewControl } from './preview-control';
import { usePreviewSession } from './use-preview-session';

vi.mock('./use-preview-session', () => ({ usePreviewSession: vi.fn() }));
const hook = vi.mocked(usePreviewSession);
const executionId = `execution-${'1'.repeat(32)}`;
const hash = 'a'.repeat(64);

function previewSession(status: 'RUNNING' | 'FAILED' | 'EXPIRED' = 'RUNNING') {
  return {
    previewId: `preview-${'2'.repeat(32)}`,
    executionId,
    status,
    health: status === 'RUNNING' ? ('HEALTHY' as const) : ('NOT_APPLICABLE' as const),
    createdAt: '2026-08-10T00:00:00.000Z',
    startedAt: status === 'RUNNING' ? '2026-08-10T00:00:01.000Z' : null,
    expiresAt: '2099-08-10T00:10:00.000Z',
    stoppedAt: status === 'RUNNING' ? null : '2026-08-10T00:10:00.000Z',
    policy: { id: 'NODE_WEB_PREVIEW_24_V1', version: '1.0.0' },
    hashes: {
      factoryResultHash: hash,
      artifactHash: 'b'.repeat(64),
      previewRequestHash: 'c'.repeat(64),
      previewSessionHash: 'd'.repeat(64),
    },
    controlPath: `/executions/${executionId}/preview`,
    failure: status === 'FAILED' ? { code: 'PREVIEW_START_FAILED' } : null,
  };
}

beforeEach(() => hook.mockReset());
afterEach(cleanup);

describe('PreviewControl', () => {
  it('does not start automatically and hides controls without Factory approval', () => {
    hook.mockReturnValue({
      state: { status: 'disabled' },
      start: vi.fn(),
      stop: vi.fn(),
      reload: vi.fn(),
      refreshSession: vi.fn(),
    });
    render(<PreviewControl executionId={executionId} factoryApproved={false} />);
    expect(screen.getByText(/only after the complete Factory Pipeline succeeds/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Start Preview' })).not.toBeInTheDocument();
  });

  it('starts only after explicit user action', () => {
    const start = vi.fn();
    hook.mockReturnValue({
      state: {
        status: 'ready',
        control: { eligibility: { status: 'ELIGIBLE' }, session: null },
        action: 'NONE',
        actionError: null,
      },
      start,
      stop: vi.fn(),
      reload: vi.fn(),
      refreshSession: vi.fn(),
    });
    render(<PreviewControl executionId={executionId} factoryApproved />);
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start Preview' }));
    expect(start).toHaveBeenCalledOnce();
  });

  it('shows View Build as an isolated POST launch and delegates Stop', () => {
    const stop = vi.fn();
    hook.mockReturnValue({
      state: {
        status: 'ready',
        control: { eligibility: { status: 'ELIGIBLE' }, session: previewSession() },
        action: 'NONE',
        actionError: null,
      },
      start: vi.fn(),
      stop,
      reload: vi.fn(),
      refreshSession: vi.fn(),
    });
    render(<PreviewControl executionId={executionId} factoryApproved />);
    const launch = screen.getByRole('button', { name: 'View Build' });
    expect(launch.closest('form')).toHaveAttribute(
      'action',
      `/previews/preview-${'2'.repeat(32)}/launch`,
    );
    expect(launch.closest('form')).toHaveAttribute('target', '_blank');
    fireEvent.click(screen.getByRole('button', { name: 'Stop Preview' }));
    expect(stop).toHaveBeenCalledOnce();
  });

  it('fails closed for an unsupported profile and renders sanitized action failure', () => {
    hook.mockReturnValue({
      state: {
        status: 'ready',
        control: { eligibility: { status: 'PROFILE_UNSUPPORTED' }, session: null },
        action: 'NONE',
        actionError: 'Preview policy rejected the artifact.',
      },
      start: vi.fn(),
      stop: vi.fn(),
      reload: vi.fn(),
      refreshSession: vi.fn(),
    });
    render(<PreviewControl executionId={executionId} factoryApproved />);
    expect(screen.getByText(/strict web Preview profile/i)).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Preview policy rejected the artifact.');
    expect(screen.queryByRole('button', { name: 'Start Preview' })).not.toBeInTheDocument();
  });
});
