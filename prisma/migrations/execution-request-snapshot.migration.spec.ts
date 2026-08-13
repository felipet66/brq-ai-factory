import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIGRATIONS_ROOT = dirname(fileURLToPath(import.meta.url));
const MIGRATION = '20260812190000_execution_request_snapshot';
const PREVIOUS_MIGRATION = '20260812180000_ai_response_cache';

async function migrationSql(name: string): Promise<string> {
  return readFile(join(MIGRATIONS_ROOT, name, 'migration.sql'), 'utf8');
}

describe('execution request snapshot migration', () => {
  it('adds an owner-scoped private replay root without changing historical executions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brq-execution-snapshot-migration-'));
    const database = new DatabaseSync(join(directory, 'upgrade.db'));

    try {
      database.exec('PRAGMA foreign_keys=ON;');
      const migrationNames = (await readdir(MIGRATIONS_ROOT))
        .filter((entry) => /^\d{14}_[a-z0-9_]+$/u.test(entry))
        .sort();
      const targetIndex = migrationNames.indexOf(MIGRATION);
      expect(targetIndex).toBeGreaterThan(migrationNames.indexOf(PREVIOUS_MIGRATION));

      for (const migration of migrationNames.slice(0, targetIndex)) {
        database.exec(await migrationSql(migration));
      }
      database.exec(`
        INSERT INTO "User" (
          "id", "email", "name", "emailVerified", "role", "createdAt", "updatedAt"
        ) VALUES (
          'snapshot-owner', 'snapshot-owner@example.com', 'Snapshot owner', 1, 'USER',
          '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
        );
        INSERT INTO "ExecutionRecord" (
          "storageId", "userId", "workflowId", "executionId", "projectName", "status",
          "createdAt", "engineVersion", "contractVersion"
        ) VALUES (
          'historical-record', 'snapshot-owner', 'workflow-historical',
          'execution-${'a'.repeat(32)}', 'Historical project', 'FAILED',
          '2026-08-12T00:00:00.000Z', '1.0.0', '1.0.0'
        );
      `);

      const sql = await migrationSql(MIGRATION);
      expect(await migrationSql(MIGRATION)).toBe(sql);
      database.exec(sql);

      const columns = database.prepare('PRAGMA table_info("ExecutionRequestSnapshot")').all() as {
        readonly name: string;
        readonly notnull: number;
        readonly pk: number;
      }[];
      expect(columns.map(({ name }) => name).sort()).toEqual(
        [
          'executionId',
          'ownerId',
          'requestHash',
          'version',
          'request',
          'replaySourceExecutionId',
          'replayCacheExecutionId',
          'replayMode',
          'createdAt',
        ].sort(),
      );
      expect(columns.find(({ name }) => name === 'executionId')).toMatchObject({
        notnull: 1,
        pk: 1,
      });
      expect(columns.find(({ name }) => name === 'ownerId')).toMatchObject({ notnull: 1 });
      expect(columns.find(({ name }) => name === 'replaySourceExecutionId')).toMatchObject({
        notnull: 0,
      });
      expect(columns.find(({ name }) => name === 'replayCacheExecutionId')).toMatchObject({
        notnull: 0,
      });
      expect(columns.find(({ name }) => name === 'replayMode')).toMatchObject({ notnull: 0 });
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM "ExecutionRequestSnapshot"').get(),
      ).toEqual({ count: 0 });
      expect(
        database
          .prepare('SELECT "status" FROM "ExecutionRecord" WHERE "storageId" = ?')
          .get('historical-record'),
      ).toEqual({ status: 'FAILED' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
