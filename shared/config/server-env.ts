import { z } from 'zod';

import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

const serverEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .trim()
    .startsWith('file:', 'DATABASE_URL deve apontar para SQLite local.'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: NodeJS.ProcessEnv): ServerEnv {
  const result = serverEnvSchema.safeParse(source);

  if (!result.success) {
    throw new AppError('Configuração de ambiente inválida.', {
      code: ERROR_CODES.INVALID_ENVIRONMENT,
      cause: result.error,
    });
  }

  return result.data;
}
