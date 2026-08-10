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

function columnNames(database: DatabaseSync, table: string): string[] {
  return database
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .map((column) => (column as { readonly name: string }).name)
    .sort();
}

describe('factory pipeline metadata migration', () => {
  it('adiciona somente estruturas metadata-safe e preserva registros históricos sem evidência', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brq-factory-pipeline-migration-'));
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
          "storageId", "userId", "workflowId", "projectName", "status", "createdAt",
          "engineVersion", "contractVersion"
        ) VALUES (
          'execution-record-history', 'user-legacy-execution-owner', 'workflow-history',
          'Historical project', 'SUCCESS', '2026-08-09T12:00:00.000Z', '1.0.0', '1.0.0'
        );
      `);

      database.exec(await migrationSql('20260809220000_factory_pipeline_metadata'));

      expect(columnNames(database, 'ExecutionFactoryResult')).toEqual(
        [
          'contractVersion',
          'durationMs',
          'executionRecordId',
          'factoryResultHash',
          'factoryVersion',
          'failureCode',
          'failureKind',
          'failureSourceCode',
          'failureStageId',
          'finishedAt',
          'generatedFileCount',
          'generatedTotalBytes',
          'generationStatus',
          'lineageHash',
          'provenanceHash',
          'readiness',
          'sandboxResourceOutcome',
          'sandboxRunId',
          'sandboxStatus',
          'startedAt',
          'status',
          'terminalStage',
          'workspaceFileCount',
          'workspaceId',
          'workspaceReleaseStatus',
          'workspaceTotalBytes',
        ].sort(),
      );
      expect(columnNames(database, 'ExecutionFactoryLineage')).toEqual(
        [
          'bundleContentHash',
          'bundleHash',
          'executionFactoryResultId',
          'executionHash',
          'factoryResultHash',
          'generationHash',
          'productOwnerSpecificationHash',
          'qaSpecificationHash',
          'sandboxRequestHash',
          'sandboxResultHash',
          'technicalSpecificationHash',
          'workflowHash',
          'workspaceHash',
          'workspacePlanHash',
        ].sort(),
      );
      const provenanceColumns = columnNames(database, 'ExecutionFactoryProvenance');
      expect(provenanceColumns).toEqual(
        [
          'codeGeneratorAgentVersion',
          'codeGeneratorAssetBundleHash',
          'codeGeneratorContractVersion',
          'executionFactoryResultId',
          'sandboxAdapter',
          'sandboxCommandPolicyHash',
          'sandboxContractVersion',
          'sandboxDependencySnapshotHash',
          'sandboxHelperAbiVersion',
          'sandboxImageDigest',
          'sandboxImageId',
          'sandboxLimitsHash',
          'sandboxPlatform',
          'sandboxPolicyHash',
          'sandboxPolicyId',
          'sandboxPolicyVersion',
          'sandboxRunnerVersion',
          'sandboxRuntimeName',
          'sandboxRuntimeVersion',
          'sandboxSanitizerVersion',
          'workspaceConfigurationHash',
          'workspaceContractVersion',
          'workspacePolicyHash',
          'workspaceVersion',
        ].sort(),
      );
      expect(provenanceColumns).not.toEqual(
        expect.arrayContaining(['imageReference', 'prompt', 'code', 'path', 'stdout', 'stderr']),
      );
      expect(
        database
          .prepare(
            'SELECT COUNT(*) AS "count" FROM "ExecutionFactoryResult" WHERE "executionRecordId" = ?',
          )
          .get('execution-record-history'),
      ).toEqual({ count: 0 });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
