import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { parseServerEnv } from '@brq/shared/config/server-env';

import { PrismaClient } from '../generated/prisma/client';

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  const url = databaseUrl ?? parseServerEnv(process.env).DATABASE_URL;
  const adapter = new PrismaBetterSqlite3({ url });

  return new PrismaClient({ adapter });
}

export type DatabaseClient = PrismaClient;
