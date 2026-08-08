import { z } from 'zod';

export const authenticatedUserRoleSchema = z.enum(['ADMIN', 'USER']);

export const authenticatedUserSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(200),
    email: z.string().email().max(254),
    role: authenticatedUserRoleSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const loginCredentialsSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();

export type AuthenticatedUserRole = z.infer<typeof authenticatedUserRoleSchema>;

export interface AuthenticatedUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: AuthenticatedUserRole;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LoginCredentials {
  readonly email: string;
  readonly password: string;
}
