import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIGRATIONS_ROOT = dirname(fileURLToPath(import.meta.url));

async function migrationSql(name: string): Promise<string> {
  return readFile(join(MIGRATIONS_ROOT, name, 'migration.sql'), 'utf8');
}

describe('authentication ownership migration', () => {
  it('backfills legacy execution records without changing their jobs or technical metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brq-auth-ownership-migration-'));
    const database = new DatabaseSync(join(directory, 'upgrade.db'));

    try {
      database.exec('PRAGMA foreign_keys=ON;');
      database.exec(await migrationSql('20260807170000_execution_repository'));
      database.exec(await migrationSql('20260807180000_job_queue'));
      database.exec(`
        INSERT INTO "ExecutionRecord" (
          "storageId",
          "workflowId",
          "executionId",
          "projectName",
          "status",
          "createdAt",
          "engineVersion",
          "contractVersion"
        ) VALUES (
          'execution-record-legacy',
          'workflow-legacy',
          'execution-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'Legacy project',
          'CREATED',
          '2026-08-07T12:00:00.000Z',
          '1.0.0',
          '1.0.0'
        );
        INSERT INTO "ExecutionJob" (
          "jobId",
          "executionRecordId",
          "status",
          "queuedAt"
        ) VALUES (
          'job-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'execution-record-legacy',
          'QUEUED',
          '2026-08-07T12:00:00.000Z'
        );
        INSERT INTO "ExecutionRecordHash" (
          "executionRecordId",
          "executionHash"
        ) VALUES (
          'execution-record-legacy',
          '${'a'.repeat(64)}'
        );
        INSERT INTO "ExecutionRecordLifecycleEvent" (
          "id",
          "executionRecordId",
          "sequence",
          "event",
          "state",
          "occurredAt"
        ) VALUES (
          'lifecycle-legacy',
          'execution-record-legacy',
          1,
          'EXECUTION_CREATED',
          'CREATED',
          '2026-08-07T12:00:00.000Z'
        );
      `);

      database.exec(await migrationSql('20260807190000_authentication_ownership'));

      const execution = database
        .prepare(
          'SELECT "userId", "workflowId", "executionId", "engineVersion", "contractVersion" FROM "ExecutionRecord" WHERE "storageId" = ?',
        )
        .get('execution-record-legacy');
      const principal = database
        .prepare('SELECT "email", "role" FROM "User" WHERE "id" = ?')
        .get('user-legacy-execution-owner');
      const accountCount = database
        .prepare('SELECT COUNT(*) AS "count" FROM "Account" WHERE "userId" = ?')
        .get('user-legacy-execution-owner') as { readonly count: number };
      const jobCount = database
        .prepare('SELECT COUNT(*) AS "count" FROM "ExecutionJob" WHERE "executionRecordId" = ?')
        .get('execution-record-legacy') as { readonly count: number };
      const hashes = database
        .prepare('SELECT "executionHash" FROM "ExecutionRecordHash" WHERE "executionRecordId" = ?')
        .get('execution-record-legacy');
      const lifecycleCount = database
        .prepare(
          'SELECT COUNT(*) AS "count" FROM "ExecutionRecordLifecycleEvent" WHERE "executionRecordId" = ?',
        )
        .get('execution-record-legacy') as { readonly count: number };
      const userIdColumn = database
        .prepare('PRAGMA table_info("ExecutionRecord")')
        .all()
        .find((column) => (column as { readonly name: string }).name === 'userId') as {
        readonly notnull: number;
      };
      const accountIndexes = database
        .prepare('PRAGMA index_list("Account")')
        .all() as unknown as readonly {
        readonly name: string;
        readonly unique: number;
      }[];

      expect(execution).toEqual({
        userId: 'user-legacy-execution-owner',
        workflowId: 'workflow-legacy',
        executionId: 'execution-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        engineVersion: '1.0.0',
        contractVersion: '1.0.0',
      });
      expect(principal).toEqual({
        email: 'legacy-execution-owner@invalid.local',
        role: 'USER',
      });
      expect(accountCount.count).toBe(0);
      expect(jobCount.count).toBe(1);
      expect(hashes).toEqual({ executionHash: 'a'.repeat(64) });
      expect(lifecycleCount.count).toBe(1);
      expect(userIdColumn.notnull).toBe(1);
      expect(accountIndexes).toContainEqual({
        name: 'Account_providerId_accountId_key',
        unique: 1,
        origin: 'c',
        partial: 0,
        seq: expect.any(Number),
      });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
