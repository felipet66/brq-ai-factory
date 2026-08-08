import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthenticatedHeader } from './authenticated-header';
import { CurrentUser } from './current-user';
import { ProfileView } from './profile-view';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

const USER = Object.freeze({
  id: 'user-001',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'ADMIN' as const,
  createdAt: '2026-08-07T12:00:00.000Z',
  updatedAt: '2026-08-07T12:05:00.000Z',
});

afterEach(cleanup);

describe('authenticated user presentation', () => {
  it('renders a minimized current-user link', () => {
    render(<CurrentUser currentUser={USER} />);

    const profileLink = screen.getByRole('link', { name: 'Open current user profile' });
    expect(profileLink).toHaveAttribute('href', '/profile');
    expect(profileLink).toHaveTextContent('Ada Lovelace');
    expect(profileLink).toHaveTextContent('ada@example.com · ADMIN');
    expect(profileLink.textContent).not.toMatch(/token|session|password/i);
  });

  it('provides authenticated navigation and logout without embedding session internals', () => {
    render(<AuthenticatedHeader currentUser={USER} />);

    expect(screen.getByRole('link', { name: 'BRQ AI Factory' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'New execution' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', '/executions');
    expect(screen.getByRole('link', { name: 'Playground' })).toHaveAttribute('href', '/playground');
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/token|cookie|session id/i);
  });

  it('does not advertise the ADMIN-only Playground to a USER', () => {
    render(<AuthenticatedHeader currentUser={{ ...USER, role: 'USER' }} />);

    expect(screen.queryByRole('link', { name: 'Playground' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'History' })).toBeInTheDocument();
  });

  it('renders exactly the six approved public profile fields as text', () => {
    render(<ProfileView currentUser={USER} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeInTheDocument();
    for (const label of ['ID', 'Name', 'Email', 'Role', 'Created at', 'Updated at']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('user-001')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('ADMIN')).toBeInTheDocument();
    expect(screen.getByText(USER.createdAt)).toHaveAttribute('datetime', USER.createdAt);
    expect(screen.getByText(USER.updatedAt)).toHaveAttribute('datetime', USER.updatedAt);
    expect(document.body.textContent).not.toMatch(/token|cookie|password|session id/i);
  });
});
