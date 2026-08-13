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

describe('Factory profile rule diagnostics migration', () => {
  it('adds nullable structural diagnostics and leaves historical rows null', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brq-factory-profile-rule-migration-'));
    const database = new DatabaseSync(join(directory, 'upgrade.db'));

    try {
      database.exec('PRAGMA foreign_keys=ON;');
      for (const migration of [
        '20260807170000_execution_repository',
        '20260807180000_job_queue',
        '20260807190000_authentication_ownership',
        '20260809220000_factory_pipeline_metadata',
        '20260811052000_factory_execution_profile_reason_codes',
        '20260811220000_readiness_decision_evidence',
      ]) {
        database.exec(await migrationSql(migration));
      }
      database.exec(`
        INSERT INTO "ExecutionRecord" (
          "storageId", "userId", "workflowId", "executionId", "projectName", "status",
          "createdAt", "engineVersion", "contractVersion"
        ) VALUES (
          'execution-record-profile-rule', 'user-legacy-execution-owner',
          'workflow-profile-rule', 'execution-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'Historical profile failure', 'FAILED', '2026-08-12T00:00:00.000Z',
          '1.0.0', '1.0.0'
        );
        INSERT INTO "ExecutionFactoryResult" (
          "executionRecordId", "factoryVersion", "contractVersion", "status", "startedAt",
          "finishedAt", "durationMs", "terminalStage", "factoryResultHash", "lineageHash",
          "provenanceHash", "generationStatus", "workspaceReleaseStatus", "sandboxStatus",
          "sandboxResourceOutcome", "failureKind", "failureCode", "failureReasonCode",
          "failureStageId"
        ) VALUES (
          'execution-record-profile-rule', '1.1.0', '1.1.0', 'FAILED',
          '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:01.000Z', 1000,
          'CODE_PROFILE_VALIDATION', '${'a'.repeat(64)}', '${'b'.repeat(64)}',
          '${'c'.repeat(64)}', 'SUCCESS', 'NOT_REQUIRED', 'SKIPPED', 'NONE',
          'FACTORY_PIPELINE', 'FACTORY_PIPELINE_CODE_PROFILE_VALIDATION_FAILED',
          'EXTERNAL_OR_UNSAFE_REFERENCE', 'CODE_PROFILE_VALIDATION'
        );
        INSERT INTO "ExecutionFactoryStageResult" (
          "id", "executionFactoryResultId", "ordinal", "stageId", "status", "failureCode",
          "reasonCode"
        ) VALUES (
          'factory-profile-rule-stage', 'execution-record-profile-rule', 4,
          'CODE_PROFILE_VALIDATION', 'FAILED',
          'FACTORY_PIPELINE_CODE_PROFILE_VALIDATION_FAILED', 'EXTERNAL_OR_UNSAFE_REFERENCE'
        );
      `);

      database.exec(await migrationSql('20260812053000_factory_profile_rule_diagnostics'));

      expect(
        database
          .prepare('PRAGMA table_info("ExecutionFactoryResult")')
          .all()
          .find((column) => column.name === 'failureProfileRuleId'),
      ).toMatchObject({ name: 'failureProfileRuleId', notnull: 0 });
      expect(
        database
          .prepare('PRAGMA table_info("ExecutionFactoryStageResult")')
          .all()
          .find((column) => column.name === 'profileRuleId'),
      ).toMatchObject({ name: 'profileRuleId', notnull: 0 });
      expect(
        database
          .prepare(
            'SELECT "failureProfileRuleId" FROM "ExecutionFactoryResult" WHERE "executionRecordId" = ?',
          )
          .get('execution-record-profile-rule'),
      ).toEqual({ failureProfileRuleId: null });
      expect(
        database
          .prepare(
            'SELECT "profileRuleId" FROM "ExecutionFactoryStageResult" WHERE "executionFactoryResultId" = ?',
          )
          .get('execution-record-profile-rule'),
      ).toEqual({ profileRuleId: null });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
