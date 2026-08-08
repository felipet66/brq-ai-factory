import { z } from 'zod';

export const AUTH_SESSION_DURATION_SECONDS = 8 * 60 * 60;
export const AUTH_PASSWORD_MIN_LENGTH = 12;
export const AUTH_PASSWORD_MAX_LENGTH = 128;

const authEnvironmentSchema = z
  .object({
    BETTER_AUTH_SECRET: z.string().min(32).max(512),
    BRQ_APP_ORIGIN: z.string().url().max(2048),
    NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  })
  .passthrough();

export interface AuthenticationConfig {
  readonly appOrigin: string;
  readonly secret: string;
  readonly production: boolean;
}

function normalizeOrigin(value: string): string {
  const parsed = new URL(value);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new TypeError('BRQ_APP_ORIGIN deve conter somente uma origem HTTP(S).');
  }
  return parsed.origin;
}

export function parseAuthenticationEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): AuthenticationConfig {
  const parsed = authEnvironmentSchema.parse(environment);
  return Object.freeze({
    appOrigin: normalizeOrigin(parsed.BRQ_APP_ORIGIN),
    secret: parsed.BETTER_AUTH_SECRET,
    production: parsed.NODE_ENV === 'production',
  });
}
