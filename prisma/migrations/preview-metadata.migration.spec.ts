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

describe('preview metadata migration', () => {
  it('persiste somente metadata segura e não fabrica Preview para execuções históricas', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brq-preview-migration-'));
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
          'execution-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Historical project', 'SUCCESS',
          '2026-08-10T12:00:00.000Z', '1.0.0', '1.0.0'
        );
      `);

      database.exec(await migrationSql('20260810140000_preview_metadata'));

      expect(columnNames(database, 'PreviewArtifact')).toEqual(
        [
          'approvalHash',
          'approvedAt',
          'artifactContentHash',
          'artifactHash',
          'artifactId',
          'artifactVersion',
          'consumedAt',
          'contractVersion',
          'createdAt',
          'deletedAt',
          'executionRecordId',
          'expiresAt',
          'exporterVersion',
          'factoryResultHash',
          'fileCount',
          'hashAlgorithm',
          'profileId',
          'revision',
          'sandboxRequestHash',
          'sandboxResultHash',
          'status',
          'totalBytes',
          'workspaceHash',
        ].sort(),
      );
      expect(columnNames(database, 'PreviewSession')).toEqual(
        [
          'artifactApprovalHash',
          'artifactBytes',
          'artifactExpiresAt',
          'artifactFileCount',
          'artifactFiles',
          'artifactHash',
          'artifactId',
          'artifactProfileId',
          'artifactTotalBytes',
          'capturedLogBytes',
          'cpus',
          'createdAt',
          'executionRecordId',
          'expiresAt',
          'factoryResultHash',
          'failureCode',
          'failureSourceCode',
          'failureStage',
          'healthTimeoutMs',
          'health',
          'lineageHash',
          'limitsHash',
          'maxLogLineBytes',
          'memoryBytes',
          'openFilesLimit',
          'pidsLimit',
          'policyHash',
          'policyId',
          'policyVersion',
          'previewId',
          'previewRequestHash',
          'previewSessionHash',
          'provenanceHash',
          'responseBytes',
          'responseTimeoutMs',
          'revision',
          'sandboxRequestHash',
          'sandboxResultHash',
          'startedAt',
          'startupTimeoutMs',
          'status',
          'stopTimeoutMs',
          'stoppedAt',
          'stoppingAt',
          'temporaryBytes',
          'ttlSeconds',
          'workspaceHash',
        ].sort(),
      );
      expect(columnNames(database, 'PreviewAccessTicket')).toEqual(
        [
          'consumedAt',
          'expiresAt',
          'issuedAt',
          'previewSessionId',
          'revokedAt',
          'ticketHash',
        ].sort(),
      );
      expect(columnNames(database, 'PreviewSessionEvent')).toEqual(
        [
          'artifactHash',
          'contractVersion',
          'durationMs',
          'event',
          'failureCode',
          'id',
          'occurredAt',
          'policyId',
          'previewRequestHash',
          'previewSessionHash',
          'previewSessionId',
          'sequence',
          'status',
        ].sort(),
      );
      expect(columnNames(database, 'PreviewSessionProvenance')).toEqual(
        [
          'artifactContractVersion',
          'artifactVersion',
          'contractVersion',
          'exporterVersion',
          'hashAlgorithm',
          'limitsHash',
          'policyHash',
          'policyId',
          'policyVersion',
          'previewSessionId',
          'runnerVersion',
          'runtimeAdapter',
          'runtimeEngineName',
          'runtimeEngineVersion',
          'runtimeImageDigest',
          'runtimeImageId',
          'runtimeImageReference',
          'runtimeName',
          'runtimePlatform',
          'runtimeServerAbiVersion',
          'runtimeVersion',
        ].sort(),
      );

      const previewColumns = [
        ...columnNames(database, 'PreviewArtifact'),
        ...columnNames(database, 'PreviewSession'),
        ...columnNames(database, 'PreviewSessionEvent'),
        ...columnNames(database, 'PreviewSessionProvenance'),
        ...columnNames(database, 'PreviewAccessTicket'),
      ];
      expect(previewColumns).not.toEqual(
        expect.arrayContaining([
          'artifactContent',
          'code',
          'containerId',
          'hostPath',
          'hostPort',
          'path',
          'port',
          'rawLog',
          'stderr',
          'stdout',
          'ticket',
        ]),
      );
      expect(database.prepare('SELECT COUNT(*) AS "count" FROM "PreviewArtifact"').get()).toEqual({
        count: 0,
      });
      expect(database.prepare('SELECT COUNT(*) AS "count" FROM "PreviewSession"').get()).toEqual({
        count: 0,
      });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
