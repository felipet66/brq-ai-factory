import { z } from 'zod';

import { AIProviderError, AI_PROVIDER_ERROR_CODES } from './errors';

export const DEFAULT_OPENAI_TIMEOUT_MS = 60_000;
export const DEFAULT_OPENAI_MAX_RETRIES = 2;

const openAIEnvironmentSchema = z
  .object({
    OPENAI_API_KEY: z.string().trim().min(1),
    OPENAI_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(600_000)
      .default(DEFAULT_OPENAI_TIMEOUT_MS),
    OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(DEFAULT_OPENAI_MAX_RETRIES),
  })
  .transform((environment) => ({
    apiKey: environment.OPENAI_API_KEY,
    timeoutMs: environment.OPENAI_TIMEOUT_MS,
    maxRetries: environment.OPENAI_MAX_RETRIES,
  }));

export type OpenAIConfig = z.infer<typeof openAIEnvironmentSchema>;

export function parseOpenAIConfig(source: NodeJS.ProcessEnv): OpenAIConfig {
  const result = openAIEnvironmentSchema.safeParse(source);

  if (!result.success) {
    throw new AIProviderError('Configuração do provider OpenAI inválida.', {
      code: AI_PROVIDER_ERROR_CODES.INVALID_CONFIGURATION,
      provider: 'openai',
      cause: result.error,
    });
  }

  return result.data;
}
