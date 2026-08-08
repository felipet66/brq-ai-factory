import { z } from 'zod';

import {
  CONTROLLED_WORKSPACE_ERROR_CODES,
  CONTROLLED_WORKSPACE_ERROR_STAGES,
  ControlledWorkspaceError,
} from './errors';
import {
  CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS,
  DEFAULT_CONTROLLED_WORKSPACE_LIMITS,
  type ControlledWorkspaceLimits,
} from './limits';

const positiveInteger = z.number().int().positive();

const controlledWorkspaceLimitsInputSchema = z
  .object({
    maxFiles: positiveInteger.optional(),
    maxFileBytes: positiveInteger.optional(),
    maxBundleBytes: positiveInteger.optional(),
    maxPathBytes: positiveInteger.optional(),
    maxPathSegments: positiveInteger.optional(),
    maxPathSegmentBytes: positiveInteger.optional(),
  })
  .strict();

export type ControlledWorkspaceLimitsInput = z.input<typeof controlledWorkspaceLimitsInputSchema>;

export function resolveControlledWorkspaceLimits(
  input: ControlledWorkspaceLimitsInput = {},
): ControlledWorkspaceLimits {
  const parsed = controlledWorkspaceLimitsInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ControlledWorkspaceError('A configuração do workspace controlado é inválida.', {
      code: CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_CONFIGURATION,
      stage: CONTROLLED_WORKSPACE_ERROR_STAGES.CONFIGURATION,
    });
  }

  const resolved: ControlledWorkspaceLimits = {
    maxFiles: parsed.data.maxFiles ?? DEFAULT_CONTROLLED_WORKSPACE_LIMITS.maxFiles,
    maxFileBytes: parsed.data.maxFileBytes ?? DEFAULT_CONTROLLED_WORKSPACE_LIMITS.maxFileBytes,
    maxBundleBytes:
      parsed.data.maxBundleBytes ?? DEFAULT_CONTROLLED_WORKSPACE_LIMITS.maxBundleBytes,
    maxPathBytes: parsed.data.maxPathBytes ?? DEFAULT_CONTROLLED_WORKSPACE_LIMITS.maxPathBytes,
    maxPathSegments:
      parsed.data.maxPathSegments ?? DEFAULT_CONTROLLED_WORKSPACE_LIMITS.maxPathSegments,
    maxPathSegmentBytes:
      parsed.data.maxPathSegmentBytes ?? DEFAULT_CONTROLLED_WORKSPACE_LIMITS.maxPathSegmentBytes,
  };
  for (const key of Object.keys(resolved) as (keyof ControlledWorkspaceLimits)[]) {
    if (resolved[key] > CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS[key]) {
      throw new ControlledWorkspaceError(
        'A configuração excede os limites absolutos do workspace controlado.',
        {
          code: CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_CONFIGURATION,
          stage: CONTROLLED_WORKSPACE_ERROR_STAGES.CONFIGURATION,
        },
      );
    }
  }
  if (resolved.maxFileBytes > resolved.maxBundleBytes) {
    throw new ControlledWorkspaceError(
      'O limite por arquivo não pode exceder o limite total do workspace.',
      {
        code: CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_CONFIGURATION,
        stage: CONTROLLED_WORKSPACE_ERROR_STAGES.CONFIGURATION,
      },
    );
  }
  return Object.freeze(resolved);
}
