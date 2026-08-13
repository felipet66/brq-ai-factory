import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIGRATIONS_ROOT = dirname(fileURLToPath(import.meta.url));
const MIGRATION = '20260813120000_factory_technical_checkpoint_resume';
const PREVIOUS_MIGRATION = '20260812190000_execution_request_snapshot';

async function migrationSql(name: string): Promise<string> {
  return readFile(join(MIGRATIONS_ROOT, name, 'migration.sql'), 'utf8');
}

describe('factory technical checkpoint resume migration', () => {
  it('adds append-only checkpoints and physical attempts without rewriting history', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brq-technical-resume-migration-'));
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
          'technical-owner', 'technical-owner@example.com', 'Technical owner', 1, 'USER',
          '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z'
        );
        INSERT INTO "ExecutionRecord" (
          "storageId", "userId", "workflowId", "executionId", "projectName", "status",
          "createdAt", "engineVersion", "contractVersion"
        ) VALUES (
          'technical-source', 'technical-owner', 'workflow-technical-source',
          'execution-${'1'.repeat(32)}', 'Technical source', 'FAILED',
          '2026-08-13T00:00:00.000Z', '1.0.0', '1.0.0'
        );
      `);

      const sql = await migrationSql(MIGRATION);
      expect(await migrationSql(MIGRATION)).toBe(sql);
      database.exec(sql);
      const factoryResultColumns = database
        .prepare('PRAGMA table_info("ExecutionFactoryResult")')
        .all() as { readonly name: string }[];
      expect(factoryResultColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(['sandboxCleanupFailureCode', 'sandboxCleanupSourceCode']),
      );
      database
        .prepare(
          `INSERT INTO "FactoryTechnicalCheckpoint" (
            "checkpointHash", "executionRecordId", "sourceExecutionId", "checkpointVersion",
            "bundleHash", "profileValidationHash", "payload", "createdAt"
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'a'.repeat(64),
          'technical-source',
          `execution-${'1'.repeat(32)}`,
          '1.0.0',
          'b'.repeat(64),
          'c'.repeat(64),
          '{}',
          '2026-08-13T00:00:01.000Z',
        );
      database
        .prepare(
          `INSERT INTO "FactoryTechnicalCheckpointCleanup" (
            "checkpointHash", "factoryResultHash", "releaseStatus", "completedAt"
          ) VALUES (?, ?, ?, ?)`,
        )
        .run('a'.repeat(64), 'd'.repeat(64), 'RELEASED', '2026-08-13T00:00:02.000Z');
      database
        .prepare(
          `INSERT INTO "FactoryTechnicalResumeAttempt" (
            "attemptId", "checkpointHash", "activeCheckpointHash", "ownerId", "requestId",
            "status", "startedAt", "cleanupConfirmed"
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'technical-resume-001',
          'a'.repeat(64),
          'a'.repeat(64),
          'technical-owner',
          'request-resume-001',
          'RUNNING',
          '2026-08-13T00:00:03.000Z',
          0,
        );

      expect(() =>
        database
          .prepare(
            `INSERT INTO "FactoryTechnicalResumeAttempt" (
              "attemptId", "checkpointHash", "activeCheckpointHash", "ownerId", "requestId",
              "status", "startedAt", "cleanupConfirmed"
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'technical-resume-concurrent',
            'a'.repeat(64),
            'a'.repeat(64),
            'technical-owner',
            'request-resume-concurrent',
            'RUNNING',
            '2026-08-13T00:00:03.001Z',
            0,
          ),
      ).toThrow();
      database
        .prepare(
          `INSERT INTO "FactoryTechnicalResumeAttempt" (
            "attemptId", "checkpointHash", "activeCheckpointHash", "ownerId", "requestId",
            "status", "startedAt", "finishedAt", "cleanupConfirmed", "failureReasonCode"
          ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'technical-resume-terminal',
          'a'.repeat(64),
          'technical-owner',
          'request-resume-terminal',
          'FAILED',
          '2026-08-13T00:00:02.000Z',
          '2026-08-13T00:00:02.500Z',
          0,
          'TECHNICAL_RESUME_INTERNAL_ERROR',
        );
      database
        .prepare(
          `UPDATE "FactoryTechnicalResumeAttempt"
           SET "status" = 'FAILED', "activeCheckpointHash" = NULL,
               "finishedAt" = '2026-08-13T00:00:04.000Z',
               "cleanupConfirmed" = 1,
               "failureReasonCode" = 'TECHNICAL_RESUME_INTERNAL_ERROR'
           WHERE "attemptId" = 'technical-resume-001' AND "status" = 'RUNNING'`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO "FactoryTechnicalResumeAttempt" (
            "attemptId", "checkpointHash", "activeCheckpointHash", "ownerId", "requestId",
            "status", "startedAt", "cleanupConfirmed"
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'technical-resume-next',
          'a'.repeat(64),
          'a'.repeat(64),
          'technical-owner',
          'request-resume-next',
          'RUNNING',
          '2026-08-13T00:00:05.000Z',
          0,
        );

      expect(
        database
          .prepare('SELECT "status" FROM "ExecutionRecord" WHERE "storageId" = ?')
          .get('technical-source'),
      ).toEqual({ status: 'FAILED' });
      expect(
        database
          .prepare(
            `SELECT "status", "cleanupConfirmed" FROM "FactoryTechnicalResumeAttempt"
             WHERE "attemptId" = 'technical-resume-next'`,
          )
          .get(),
      ).toEqual({ status: 'RUNNING', cleanupConfirmed: 0 });
      expect(
        database
          .prepare(
            'SELECT COUNT(*) AS "count" FROM "FactoryTechnicalResumeAttempt" WHERE "activeCheckpointHash" IS NOT NULL',
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(() =>
        database
          .prepare(
            `INSERT INTO "FactoryTechnicalCheckpoint" (
              "checkpointHash", "executionRecordId", "sourceExecutionId", "checkpointVersion",
              "bundleHash", "profileValidationHash", "payload", "createdAt"
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'e'.repeat(64),
            'technical-source',
            `execution-${'2'.repeat(32)}`,
            '1.0.0',
            'f'.repeat(64),
            '0'.repeat(64),
            '{}',
            '2026-08-13T00:00:04.000Z',
          ),
      ).toThrow();
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
