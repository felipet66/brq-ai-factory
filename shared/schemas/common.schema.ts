import { z } from 'zod';

import { AGENT_NAMES } from '../constants/agents';

const WINDOWS_RESERVED_FILENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const UNSAFE_FILENAME_CHARACTER = /[<>:"/\\|?*\u0000-\u001F]/;

export const identifierSchema = z.string().trim().min(1).max(128);

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const semanticVersionSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );

export const agentNameSchema = z.enum(AGENT_NAMES);

export const safeFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .superRefine((filename, context) => {
    if (
      filename === '.' ||
      filename === '..' ||
      filename.endsWith('.') ||
      filename.endsWith(' ') ||
      UNSAFE_FILENAME_CHARACTER.test(filename) ||
      WINDOWS_RESERVED_FILENAME.test(filename)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'filename deve conter somente um nome de arquivo seguro.',
      });
    }
  });
