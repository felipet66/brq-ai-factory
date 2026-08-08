import { hash, verify, type Options } from '@node-rs/argon2';
import { z } from 'zod';

import { AUTH_PASSWORD_MAX_LENGTH } from './config';

export const ARGON2ID_OPTIONS: Readonly<Options> = Object.freeze({
  algorithm: 2,
  version: 1,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

// Better Auth also invokes the hash callback as constant-work protection for an unknown account.
// Creation policy remains enforced by Better Auth and the seed parser; this callback must accept
// every login candidate so invalid credentials have one indistinguishable failure path.
const hashCandidateSchema = z.string().min(1).max(AUTH_PASSWORD_MAX_LENGTH);
const candidatePasswordSchema = z.string().min(1).max(AUTH_PASSWORD_MAX_LENGTH);
const argon2idHashSchema = z.string().startsWith('$argon2id$').max(512);

export async function hashPassword(password: string): Promise<string> {
  return hash(hashCandidateSchema.parse(password), ARGON2ID_OPTIONS);
}

export async function verifyPassword(input: {
  readonly hash: string;
  readonly password: string;
}): Promise<boolean> {
  const parsedHash = argon2idHashSchema.safeParse(input.hash);
  const parsedPassword = candidatePasswordSchema.safeParse(input.password);
  if (!parsedHash.success || !parsedPassword.success) return false;
  try {
    return await verify(parsedHash.data, parsedPassword.data, ARGON2ID_OPTIONS);
  } catch {
    return false;
  }
}
