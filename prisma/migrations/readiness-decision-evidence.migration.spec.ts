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

describe('Readiness decision evidence migration', () => {
  it('keeps historical provenance stages readable with null evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brq-readiness-decision-migration-'));
    const database = new DatabaseSync(join(directory, 'upgrade.db'));

    try {
      database.exec('PRAGMA foreign_keys=ON;');
      for (const migration of [
        '20260807170000_execution_repository',
        '20260807180000_job_queue',
        '20260807190000_authentication_ownership',
      ]) {
        database.exec(await migrationSql(migration));
      }
      database.exec(`
        INSERT INTO "ExecutionRecord" (
          "storageId", "userId", "workflowId", "executionId", "projectName", "status",
          "createdAt", "engineVersion", "contractVersion"
        ) VALUES (
          'execution-record-history', 'user-legacy-execution-owner', 'workflow-history',
          'execution-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Historical project', 'SUCCESS',
          '2026-08-11T00:00:00.000Z', '1.0.0', '1.0.0'
        );
        INSERT INTO "ExecutionProvenanceStage" (
          "id", "executionRecordId", "ordinal", "stage", "agent", "executionId",
          "agentExecutionId", "agentVersion", "outcome", "readiness", "assetBundleHash",
          "knowledgeContextHash", "promptHash", "responseHash", "validationHash"
        ) VALUES (
          'provenance-stage-history', 'execution-record-history', 0, 'PRODUCT_OWNER',
          'PRODUCT_OWNER', 'execution-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'po-history',
          '1.0.0', 'GENERATED', 'READY', '${'a'.repeat(64)}',
          'sha256:${'b'.repeat(64)}', '${'c'.repeat(64)}', '${'d'.repeat(64)}',
          '${'e'.repeat(64)}'
        );
      `);

      database.exec(await migrationSql('20260811220000_readiness_decision_evidence'));

      expect(
        database
          .prepare('SELECT "readinessDecision" FROM "ExecutionProvenanceStage" WHERE "id" = ?')
          .get('provenance-stage-history'),
      ).toEqual({ readinessDecision: null });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
