// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import type { Authentication } from './auth';
import { projectAuthenticatedUser, resolveAuthenticatedPrincipal } from './session';

describe('authenticated session resolution', () => {
  it('returns null for an absent database session', async () => {
    const authentication = {
      api: { getSession: vi.fn(async () => null) },
    } as unknown as Authentication;

    await expect(
      resolveAuthenticatedPrincipal(new Headers(), { authentication }),
    ).resolves.toBeNull();
  });

  it('maps asynchronous session-store failures to unavailable', async () => {
    const authentication = {
      api: {
        getSession: vi.fn(async () => {
          throw new Error('private database detail');
        }),
      },
    } as unknown as Authentication;

    await expect(
      resolveAuthenticatedPrincipal(new Headers(), { authentication }),
    ).rejects.toMatchObject({ kind: 'AUTHENTICATION_UNAVAILABLE' });
  });

  it('projects both Date and ISO timestamp inputs without adapter-only fields', () => {
    const projected = projectAuthenticatedUser({
      id: 'user-safe-projection',
      name: 'Safe Projection',
      email: 'safe-projection@example.local',
      role: 'USER',
      createdAt: new Date('2026-08-07T20:00:00.000Z'),
      updatedAt: '2026-08-07T20:01:00.000Z',
      emailVerified: true,
      privateAdapterField: 'must-not-leak',
    });

    expect(projected).toEqual({
      id: 'user-safe-projection',
      name: 'Safe Projection',
      email: 'safe-projection@example.local',
      role: 'USER',
      createdAt: '2026-08-07T20:00:00.000Z',
      updatedAt: '2026-08-07T20:01:00.000Z',
    });
  });

  it('maps synchronous authentication composition failures to unavailable', async () => {
    await expect(
      resolveAuthenticatedPrincipal(new Headers(), {
        getAuthentication: () => {
          throw new Error('private configuration detail');
        },
      }),
    ).rejects.toMatchObject({ kind: 'AUTHENTICATION_UNAVAILABLE' });
  });

  it('fails closed when a persisted session carries an unknown role', async () => {
    const authentication = {
      api: {
        getSession: vi.fn(async () => ({
          session: {},
          user: {
            id: 'user-invalid-role',
            name: 'Invalid Role',
            email: 'invalid-role@example.local',
            role: 'ROOT',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        })),
      },
    } as unknown as Authentication;

    await expect(
      resolveAuthenticatedPrincipal(new Headers(), { authentication }),
    ).rejects.toMatchObject({ kind: 'AUTHORIZATION_DENIED' });
  });
});
