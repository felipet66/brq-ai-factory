import type { z } from 'zod';

import type {
  logLevelSchema,
  logRecordCreateInputSchema,
  logRecordSchema,
} from '../schemas/log-record.schema';

export type LogLevel = z.infer<typeof logLevelSchema>;
export type LogRecordCreateInput = z.infer<typeof logRecordCreateInputSchema>;
export type LogRecord = z.infer<typeof logRecordSchema>;
