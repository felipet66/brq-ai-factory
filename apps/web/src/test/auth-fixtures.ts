import type { AuthenticatedUser } from '@/api/auth-contracts';

export const AUTHENTICATED_USER: AuthenticatedUser = Object.freeze({
  id: 'user-001',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'ADMIN',
  createdAt: '2026-08-07T12:00:00.000Z',
  updatedAt: '2026-08-07T12:05:00.000Z',
});
