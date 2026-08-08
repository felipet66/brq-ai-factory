import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrismaClient } from '@brq/prisma';

import {
  loadLocalSeedProcessEnvironment,
  parseLocalSeedEnvironment,
  resolveLocalSeedDatabaseUrl,
  seedLocalAuthenticationUsers,
} from './src/server/auth/seed.ts';

let client;

try {
  const rootEnvironmentPath = resolve(dirname(fileURLToPath(import.meta.url)), '../..', '.env');
  const environment = loadLocalSeedProcessEnvironment(process.env, rootEnvironmentPath);
  const projectRoot = dirname(rootEnvironmentPath);
  client = createPrismaClient(resolveLocalSeedDatabaseUrl(environment.DATABASE_URL, projectRoot));
  const configuration = parseLocalSeedEnvironment(environment);
  const userIds = await seedLocalAuthenticationUsers(client, configuration);
  console.info(`Seed local de autenticação concluído para ${userIds.length} usuários.`);
} catch {
  process.exitCode = 1;
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'auth.seed.failed',
      error: { code: 'AUTH_SEED_FAILED' },
    }),
  );
} finally {
  if (client !== undefined) {
    try {
      await client.$disconnect();
    } catch {
      process.exitCode = 1;
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'auth.seed.disconnect.failed',
          error: { code: 'AUTH_SEED_DISCONNECT_FAILED' },
        }),
      );
    }
  }
}
