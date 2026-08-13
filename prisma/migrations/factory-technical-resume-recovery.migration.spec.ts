import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIGRATIONS_ROOT = dirname(fileURLToPath(import.meta.url));
const CHECKPOINT_MIGRATION = '20260813120000_factory_technical_checkpoint_resume';
const RECOVERY_MIGRATION = '20260813150000_factory_technical_resume_recovery';
const PREVIOUS_MIGRATION = '20260812190000_execution_request_snapshot';
const CHECKPOINT_HASH = 'a'.repeat(64);
const SOURCE_EXECUTION_ID = `execution-${'1'.repeat(32)}`;

async function migrationSql(name: string): Promise<string> {
  return readFile(join(MIGRATIONS_ROOT, name, 'migration.sql'), 'utf8');
}

describe('factory technical resume recovery migration', () => {
  it('upgrades legacy active attempts safely while preserving terminal history and single-flight', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brq-technical-resume-recovery-migration-'));
    const database = new DatabaseSync(join(directory, 'upgrade.db'));
    try {
      database.exec('PRAGMA foreign_keys=ON;');
      const migrationNames = (await readdir(MIGRATIONS_ROOT))
        .filter((entry) => /^\d{14}_[a-z0-9_]+$/u.test(entry))
        .sort();
      const checkpointIndex = migrationNames.indexOf(CHECKPOINT_MIGRATION);
      const recoveryIndex = migrationNames.indexOf(RECOVERY_MIGRATION);
      expect(checkpointIndex).toBeGreaterThan(migrationNames.indexOf(PREVIOUS_MIGRATION));
      expect(recoveryIndex).toBe(checkpointIndex + 1);

      for (const migration of migrationNames.slice(0, checkpointIndex)) {
        database.exec(await migrationSql(migration));
      }
      database.exec(await migrationSql(CHECKPOINT_MIGRATION));
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
          '${SOURCE_EXECUTION_ID}', 'Technical source', 'FAILED',
          '2026-08-13T00:00:00.000Z', '1.0.0', '1.0.0'
        );
        INSERT INTO "FactoryTechnicalCheckpoint" (
          "checkpointHash", "executionRecordId", "sourceExecutionId", "checkpointVersion",
          "bundleHash", "profileValidationHash", "payload", "createdAt"
        ) VALUES (
          '${CHECKPOINT_HASH}', 'technical-source', '${SOURCE_EXECUTION_ID}', '1.0.0',
          '${'b'.repeat(64)}', '${'c'.repeat(64)}', '{}', '2026-08-13T00:00:01.000Z'
        );
      `);

      const insertAttempt = database.prepare(`
        INSERT INTO "FactoryTechnicalResumeAttempt" (
          "attemptId", "checkpointHash", "activeCheckpointHash", "ownerId", "requestId",
          "status", "startedAt", "finishedAt", "resultHash", "result", "cleanupConfirmed",
          "failureReasonCode"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertAttempt.run(
        'technical-resume-legacy-running',
        CHECKPOINT_HASH,
        CHECKPOINT_HASH,
        'technical-owner',
        'request-legacy-running',
        'RUNNING',
        '2026-08-13T00:00:02.000Z',
        null,
        null,
        null,
        0,
        null,
      );
      insertAttempt.run(
        'technical-resume-success',
        CHECKPOINT_HASH,
        null,
        'technical-owner',
        'request-success',
        'SUCCESS',
        '2026-08-13T00:00:03.000Z',
        '2026-08-13T00:00:04.000Z',
        'd'.repeat(64),
        '{"status":"SUCCESS"}',
        1,
        null,
      );
      insertAttempt.run(
        'technical-resume-failed',
        CHECKPOINT_HASH,
        null,
        'technical-owner',
        'request-failed',
        'FAILED',
        '2026-08-13T00:00:05.000Z',
        '2026-08-13T00:00:06.000Z',
        null,
        null,
        1,
        'RUNTIME_PREFLIGHT_FAILED',
      );
      insertAttempt.run(
        'technical-resume-cancelled',
        CHECKPOINT_HASH,
        null,
        'technical-owner',
        'request-cancelled',
        'CANCELLED',
        '2026-08-13T00:00:07.000Z',
        '2026-08-13T00:00:08.000Z',
        'e'.repeat(64),
        '{"status":"CANCELLED"}',
        1,
        'TECHNICAL_RESUME_CANCELLED',
      );

      const recoverySql = await migrationSql(RECOVERY_MIGRATION);
      expect(await migrationSql(RECOVERY_MIGRATION)).toBe(recoverySql);
      database.exec(recoverySql);

      expect(
        database
          .prepare(
            `SELECT "status", "activePhase", "activeCheckpointHash", "recoveryReasonCode"
             FROM "FactoryTechnicalResumeAttempt" WHERE "attemptId" = ?`,
          )
          .get('technical-resume-legacy-running'),
      ).toEqual({
        status: 'RUNNING',
        activePhase: 'RECOVERY_REQUIRED',
        activeCheckpointHash: CHECKPOINT_HASH,
        recoveryReasonCode: 'TECHNICAL_LEGACY_ATTEMPT_RECOVERY_REQUIRED',
      });

      expect(
        database
          .prepare(
            `SELECT "attemptId", "status", "activeCheckpointHash", "finishedAt", "resultHash",
                    "result", "cleanupConfirmed", "failureReasonCode", "activePhase",
                    "recoveryReasonCode"
             FROM "FactoryTechnicalResumeAttempt"
             WHERE "status" <> 'RUNNING' ORDER BY "startedAt"`,
          )
          .all(),
      ).toEqual([
        {
          attemptId: 'technical-resume-success',
          status: 'SUCCESS',
          activeCheckpointHash: null,
          finishedAt: '2026-08-13T00:00:04.000Z',
          resultHash: 'd'.repeat(64),
          result: '{"status":"SUCCESS"}',
          cleanupConfirmed: 1,
          failureReasonCode: null,
          activePhase: null,
          recoveryReasonCode: null,
        },
        {
          attemptId: 'technical-resume-failed',
          status: 'FAILED',
          activeCheckpointHash: null,
          finishedAt: '2026-08-13T00:00:06.000Z',
          resultHash: null,
          result: null,
          cleanupConfirmed: 1,
          failureReasonCode: 'RUNTIME_PREFLIGHT_FAILED',
          activePhase: null,
          recoveryReasonCode: null,
        },
        {
          attemptId: 'technical-resume-cancelled',
          status: 'CANCELLED',
          activeCheckpointHash: null,
          finishedAt: '2026-08-13T00:00:08.000Z',
          resultHash: 'e'.repeat(64),
          result: '{"status":"CANCELLED"}',
          cleanupConfirmed: 1,
          failureReasonCode: 'TECHNICAL_RESUME_CANCELLED',
          activePhase: null,
          recoveryReasonCode: null,
        },
      ]);

      const columns = database
        .prepare('PRAGMA table_info("FactoryTechnicalResumeAttempt")')
        .all() as { readonly name: string }[];
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          'activePhase',
          'leaseId',
          'leaseVersion',
          'heartbeatAt',
          'leaseExpiresAt',
          'pendingResultHash',
          'pendingResult',
          'pendingRecordedAt',
          'recoveryReasonCode',
        ]),
      );
      const indexes = database
        .prepare('PRAGMA index_list("FactoryTechnicalResumeAttempt")')
        .all() as { readonly name: string; readonly unique: number }[];
      expect(indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'FactoryTechnicalResumeAttempt_activeCheckpointHash_key',
            unique: 1,
          }),
          expect.objectContaining({
            name: 'FactoryTechnicalResumeAttempt_status_leaseExpiresAt_idx',
            unique: 0,
          }),
        ]),
      );
      expect(
        database
          .prepare('PRAGMA index_info("FactoryTechnicalResumeAttempt_status_leaseExpiresAt_idx")')
          .all()
          .map((column) => (column as { readonly name: string }).name),
      ).toEqual(['status', 'leaseExpiresAt']);

      expect(() =>
        insertAttempt.run(
          'technical-resume-concurrent',
          CHECKPOINT_HASH,
          CHECKPOINT_HASH,
          'technical-owner',
          'request-concurrent',
          'RUNNING',
          '2026-08-13T00:00:09.000Z',
          null,
          null,
          null,
          0,
          null,
        ),
      ).toThrow();
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      const foreignKeys = database
        .prepare('PRAGMA foreign_key_list("FactoryTechnicalResumeAttempt")')
        .all() as {
        readonly table: string;
        readonly from: string;
        readonly to: string;
        readonly on_update: string;
        readonly on_delete: string;
      }[];
      expect(foreignKeys).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: 'FactoryTechnicalCheckpoint',
            from: 'checkpointHash',
            to: 'checkpointHash',
            on_update: 'CASCADE',
            on_delete: 'RESTRICT',
          }),
        ]),
      );
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
