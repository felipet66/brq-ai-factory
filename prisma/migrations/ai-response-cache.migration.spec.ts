import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIGRATIONS_ROOT = dirname(fileURLToPath(import.meta.url));
const MIGRATION = '20260812180000_ai_response_cache';
const PREVIOUS_MIGRATION = '20260812070000_typescript_diagnostic_summary';

async function migrationSql(name: string): Promise<string> {
  return readFile(join(MIGRATIONS_ROOT, name, 'migration.sql'), 'utf8');
}

describe('AI response cache migration', () => {
  it('adds an execution-scoped atomic checkpoint without copying historical prompts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brq-ai-response-cache-migration-'));
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
        INSERT INTO "PromptVersion" (
          "id", "agent", "version", "schemaVersion", "content", "hash", "status", "source",
          "createdAt", "updatedAt"
        ) VALUES (
          'historical-prompt', 'PRODUCT_OWNER', '9.9.9', '1.0.0',
          'HISTORICAL_PRIVATE_PROMPT_6f1bb2', '${'a'.repeat(64)}', 'ACTIVE', 'test',
          '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
        );
      `);

      const sql = await migrationSql(MIGRATION);
      expect(await migrationSql(MIGRATION)).toBe(sql);
      database.exec(sql);

      const columns = database.prepare('PRAGMA table_info("AiResponseCacheEntry")').all() as {
        readonly name: string;
        readonly notnull: number;
        readonly pk: number;
      }[];
      expect(columns.map(({ name }) => name).sort()).toEqual(
        [
          'executionId',
          'agent',
          'provider',
          'requestHash',
          'state',
          'claimToken',
          'responseHash',
          'response',
          'createdAt',
          'completedAt',
        ].sort(),
      );
      expect(columns.find(({ name }) => name === 'executionId')).toMatchObject({
        notnull: 1,
        pk: 1,
      });
      expect(columns.find(({ name }) => name === 'agent')).toMatchObject({ notnull: 1, pk: 2 });
      expect(columns.map(({ name }) => name)).not.toEqual(
        expect.arrayContaining(['prompt', 'instructions', 'input']),
      );

      const indexes = database
        .prepare('PRAGMA index_list("AiResponseCacheEntry")')
        .all()
        .map((index) => String(index.name));
      expect(indexes).toEqual(
        expect.arrayContaining([
          'AiResponseCacheEntry_executionId_state_idx',
          'AiResponseCacheEntry_createdAt_idx',
          'AiResponseCacheEntry_executionId_createdAt_idx',
          'AiResponseCacheEntry_provider_requestHash_idx',
          'AiResponseCacheEntry_responseHash_idx',
        ]),
      );
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM "AiResponseCacheEntry"').get(),
      ).toEqual({ count: 0 });

      const insert = database.prepare(`
        INSERT INTO "AiResponseCacheEntry" (
          "executionId", "agent", "provider", "requestHash", "state", "claimToken",
          "responseHash", "response", "completedAt"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const pendingExecutionId = `execution-${'b'.repeat(32)}`;
      insert.run(
        pendingExecutionId,
        'PRODUCT_OWNER',
        'fake',
        'b'.repeat(64),
        'PENDING',
        'claim-token',
        null,
        null,
        null,
      );
      expect(() =>
        insert.run(
          pendingExecutionId,
          'PRODUCT_OWNER',
          'other',
          'c'.repeat(64),
          'PENDING',
          'second-claim',
          null,
          null,
          null,
        ),
      ).toThrow();
      expect(() =>
        insert.run(
          `execution-${'c'.repeat(32)}`,
          'PRODUCT_OWNER',
          'fake',
          'c'.repeat(64),
          'PENDING',
          null,
          null,
          null,
          null,
        ),
      ).toThrow(/check constraint failed/i);
      insert.run(
        `execution-${'d'.repeat(32)}`,
        'CODE_GENERATOR',
        'fake',
        'd'.repeat(64),
        'COMPLETED',
        null,
        'e'.repeat(64),
        JSON.stringify({ finishReason: 'COMPLETED' }),
        '2026-08-12T01:00:00.000Z',
      );
      expect(() =>
        insert.run(
          `execution-${'e'.repeat(32)}`,
          'DEVELOPER',
          'fake',
          'e'.repeat(64),
          'COMPLETED',
          'stale-claim',
          'f'.repeat(64),
          JSON.stringify({ finishReason: 'COMPLETED' }),
          '2026-08-12T01:00:00.000Z',
        ),
      ).toThrow(/check constraint failed/i);

      expect(
        database
          .prepare('SELECT "content" FROM "PromptVersion" WHERE "id" = ?')
          .get('historical-prompt'),
      ).toEqual({ content: 'HISTORICAL_PRIVATE_PROMPT_6f1bb2' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
