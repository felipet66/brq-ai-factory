import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createPrismaClient, type DatabaseClient } from '../client';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PRISMA_CLI = resolve(PROJECT_ROOT, 'node_modules/prisma/build/index.js');

export interface DatabaseTestContext {
  client: DatabaseClient;
  databaseUrl: string;
  cleanup: () => Promise<void>;
}

export async function createDatabaseTestContext(): Promise<DatabaseTestContext> {
  const directory = await mkdtemp(join(tmpdir(), 'brq-ai-factory-persistence-'));
  const databasePath = join(directory, 'integration.db');
  const databaseUrl = `file:${databasePath}`;

  await writeFile(databasePath, '');

  try {
    await execFileAsync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  const client = createPrismaClient(databaseUrl);

  try {
    await client.$connect();
  } catch (error) {
    await client.$disconnect();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  return {
    client,
    databaseUrl,
    cleanup: async () => {
      await client.$disconnect();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
