import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIGRATIONS_ROOT = dirname(fileURLToPath(import.meta.url));
const MIGRATION = '20260812070000_typescript_diagnostic_summary';

async function migrationSql(name: string): Promise<string> {
  return readFile(join(MIGRATIONS_ROOT, name, 'migration.sql'), 'utf8');
}

describe('TypeScript diagnostic summary migration', () => {
  it('applies after the prior schema and keeps all six fields null for historical rows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brq-typescript-diagnostics-migration-'));
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
        '20260812053000_factory_profile_rule_diagnostics',
      ]) {
        database.exec(await migrationSql(migration));
      }
      database.exec(`
        INSERT INTO "ExecutionRecord" (
          "storageId", "userId", "workflowId", "executionId", "projectName", "status",
          "createdAt", "engineVersion", "contractVersion"
        ) VALUES (
          'execution-record-typescript-diagnostics', 'user-legacy-execution-owner',
          'workflow-typescript-diagnostics', 'execution-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'Historical TypeScript failure', 'FAILED', '2026-08-12T00:00:00.000Z',
          '1.0.0', '1.0.0'
        );
        INSERT INTO "ExecutionFactoryResult" (
          "executionRecordId", "factoryVersion", "contractVersion", "status", "startedAt",
          "finishedAt", "durationMs", "terminalStage", "factoryResultHash", "lineageHash",
          "provenanceHash", "generationStatus", "workspaceReleaseStatus", "sandboxStatus",
          "sandboxResourceOutcome", "failureKind", "failureCode", "failureReasonCode",
          "failureStageId"
        ) VALUES (
          'execution-record-typescript-diagnostics', '1.1.1', '1.2.0', 'FAILED',
          '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:01.000Z', 1000,
          'SANDBOX_TYPECHECK', '${'a'.repeat(64)}', '${'b'.repeat(64)}',
          '${'c'.repeat(64)}', 'SUCCESS', 'RELEASED', 'FAILED', 'NONE',
          'FACTORY_PIPELINE', 'FACTORY_PIPELINE_SANDBOX_FAILED',
          'TYPESCRIPT_DIAGNOSTICS', 'SANDBOX_TYPECHECK'
        );
        INSERT INTO "ExecutionFactoryStageResult" (
          "id", "executionFactoryResultId", "ordinal", "stageId", "status", "failureCode",
          "reasonCode"
        ) VALUES (
          'factory-typescript-diagnostics-stage',
          'execution-record-typescript-diagnostics', 7, 'SANDBOX_TYPECHECK', 'FAILED',
          'FACTORY_PIPELINE_SANDBOX_FAILED', 'TYPESCRIPT_DIAGNOSTICS'
        );
      `);

      const sql = await migrationSql(MIGRATION);
      expect(await migrationSql(MIGRATION)).toBe(sql);
      const orderedMigrations = (await readdir(MIGRATIONS_ROOT))
        .filter((entry) => /^\d{14}_[a-z0-9_]+$/u.test(entry))
        .sort();
      expect(orderedMigrations.indexOf(MIGRATION)).toBe(
        orderedMigrations.indexOf('20260812053000_factory_profile_rule_diagnostics') + 1,
      );
      database.exec(sql);

      const resultColumns = database
        .prepare('PRAGMA table_info("ExecutionFactoryResult")')
        .all()
        .filter((column) =>
          [
            'failureDiagnosticCount',
            'failureDiagnosticCodes',
            'failureDiagnosticTruncated',
          ].includes(String(column.name)),
        );
      const stageColumns = database
        .prepare('PRAGMA table_info("ExecutionFactoryStageResult")')
        .all()
        .filter((column) =>
          ['diagnosticCount', 'diagnosticCodes', 'diagnosticTruncated'].includes(
            String(column.name),
          ),
        );
      expect(resultColumns).toHaveLength(3);
      expect(stageColumns).toHaveLength(3);
      expect([...resultColumns, ...stageColumns]).toSatisfy((columns: unknown[]) =>
        columns.every(
          (column) =>
            typeof column === 'object' &&
            column !== null &&
            'notnull' in column &&
            column.notnull === 0,
        ),
      );
      expect(
        database
          .prepare(
            `
            SELECT "failureDiagnosticCount", "failureDiagnosticCodes",
                   "failureDiagnosticTruncated"
            FROM "ExecutionFactoryResult" WHERE "executionRecordId" = ?
          `,
          )
          .get('execution-record-typescript-diagnostics'),
      ).toEqual({
        failureDiagnosticCount: null,
        failureDiagnosticCodes: null,
        failureDiagnosticTruncated: null,
      });
      expect(
        database
          .prepare(
            `
            SELECT "diagnosticCount", "diagnosticCodes", "diagnosticTruncated"
            FROM "ExecutionFactoryStageResult" WHERE "executionFactoryResultId" = ?
          `,
          )
          .get('execution-record-typescript-diagnostics'),
      ).toEqual({
        diagnosticCount: null,
        diagnosticCodes: null,
        diagnosticTruncated: null,
      });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
