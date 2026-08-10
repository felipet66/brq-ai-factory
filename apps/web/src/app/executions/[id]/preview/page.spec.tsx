import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireAuthenticatedUser } from '@/server/auth/session';

import ExecutionPreviewPage from './page';

vi.mock('@/server/auth/session', () => ({ requireAuthenticatedUser: vi.fn() }));
vi.mock('@/components/auth/authenticated-header', () => ({
  AuthenticatedHeader: () => <header>Authenticated navigation</header>,
}));
vi.mock('@/components/factory/preview-experience', () => ({
  PreviewExperience: ({ executionId }: { readonly executionId: string }) => (
    <main>Preview control for {executionId}</main>
  ),
}));

beforeEach(() => {
  vi.mocked(requireAuthenticatedUser).mockReset();
  vi.mocked(requireAuthenticatedUser).mockResolvedValue({
    id: 'user-1',
    name: 'User',
    email: 'user@example.local',
    role: 'USER',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  });
});

describe('ExecutionPreviewPage', () => {
  it('requires authentication and delegates only the execution ID to presentation', async () => {
    render(
      await ExecutionPreviewPage({
        params: Promise.resolve({ id: `execution-${'1'.repeat(32)}` }),
      }),
    );
    expect(requireAuthenticatedUser).toHaveBeenCalledOnce();
    expect(screen.getByText(`Preview control for execution-${'1'.repeat(32)}`)).toBeVisible();
  });
});
