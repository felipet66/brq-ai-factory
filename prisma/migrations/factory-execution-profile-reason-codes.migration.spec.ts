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

describe('Factory execution profile and reason-code migration', () => {
  it('adds nullable metadata only and leaves historical reason/profile fields null', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brq-factory-profile-migration-'));
    const database = new DatabaseSync(join(directory, 'upgrade.db'));

    try {
      database.exec('PRAGMA foreign_keys=ON;');
      for (const migration of [
        '20260807170000_execution_repository',
        '20260807180000_job_queue',
        '20260807190000_authentication_ownership',
        '20260809220000_factory_pipeline_metadata',
      ]) {
        database.exec(await migrationSql(migration));
      }
      database.exec(`
        INSERT INTO "ExecutionRecord" (
          "storageId", "userId", "workflowId", "executionId", "projectName", "status",
          "createdAt", "engineVersion", "contractVersion"
        ) VALUES (
          'execution-record-history', 'user-legacy-execution-owner', 'workflow-history',
          'execution-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Historical project', 'FAILED',
          '2026-08-11T00:00:00.000Z', '1.0.0', '1.0.0'
        );
        INSERT INTO "ExecutionFactoryResult" (
          "executionRecordId", "factoryVersion", "contractVersion", "status", "startedAt",
          "finishedAt", "durationMs", "terminalStage", "factoryResultHash", "lineageHash",
          "provenanceHash", "generationStatus", "workspaceReleaseStatus", "sandboxStatus",
          "sandboxResourceOutcome", "failureKind", "failureCode", "failureSourceCode",
          "failureStageId"
        ) VALUES (
          'execution-record-history', '1.0.0', '1.0.0', 'FAILED',
          '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:01.000Z', 1000,
          'SANDBOX_PREPARE', '${'a'.repeat(64)}', '${'b'.repeat(64)}', '${'c'.repeat(64)}',
          'SUCCESS', 'RELEASED', 'FAILED', 'NONE', 'FACTORY_PIPELINE',
          'SANDBOX_STEP_FAILED', 'EXIT_1', 'SANDBOX_PREPARE'
        );
        INSERT INTO "ExecutionFactoryStageResult" (
          "id", "executionFactoryResultId", "ordinal", "stageId", "status", "failureCode"
        ) VALUES (
          'factory-stage-history', 'execution-record-history', 0, 'SANDBOX_PREPARE',
          'FAILED', 'SANDBOX_STEP_FAILED'
        );
        INSERT INTO "ExecutionFactoryLineage" (
          "executionFactoryResultId", "executionHash", "factoryResultHash"
        ) VALUES ('execution-record-history', '${'d'.repeat(64)}', '${'a'.repeat(64)}');
        INSERT INTO "ExecutionFactoryProvenance" ("executionFactoryResultId")
        VALUES ('execution-record-history');
      `);

      database.exec(await migrationSql('20260811052000_factory_execution_profile_reason_codes'));

      expect(
        database
          .prepare(
            'SELECT "failureReasonCode" FROM "ExecutionFactoryResult" WHERE "executionRecordId" = ?',
          )
          .get('execution-record-history'),
      ).toEqual({ failureReasonCode: null });
      expect(
        database
          .prepare(
            'SELECT "reasonCode" FROM "ExecutionFactoryStageResult" WHERE "executionFactoryResultId" = ?',
          )
          .get('execution-record-history'),
      ).toEqual({ reasonCode: null });
      expect(
        database
          .prepare(
            'SELECT "executionProfileHash", "generationProjectionHash", "profileValidationHash" FROM "ExecutionFactoryLineage" WHERE "executionFactoryResultId" = ?',
          )
          .get('execution-record-history'),
      ).toEqual({
        executionProfileHash: null,
        generationProjectionHash: null,
        profileValidationHash: null,
      });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
