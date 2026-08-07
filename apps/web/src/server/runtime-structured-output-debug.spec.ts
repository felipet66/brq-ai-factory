// @vitest-environment node

import { fileURLToPath } from 'node:url';

import { FakeAIProvider } from '@brq/ai-provider/fake';
import {
  createDeveloperAIResponse,
  createTechnicalSpecification,
} from '../../../../agents/developer/testing/developer-fixtures';
import {
  createProductOwnerAIResponse,
  createProductOwnerSpecification,
} from '../../../../agents/product-owner/testing/product-owner-fixtures';
import { executionRequestSchema } from '@brq/execution-engine';
import { createInMemoryExecutionRecordRepository } from '@brq/execution-repository';
import { createInMemoryExecutionHistory } from '@brq/observability';
import type { JsonObject } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import { toExecutionHistoryDetail } from '../app/api/_lib/execution-history-projection';
import { capturedLogger, executionBody, FIXED_REQUEST_ID } from '../test/api-fixtures';
import { createApplicationRuntime } from './runtime';

const KNOWLEDGE_ROOT = fileURLToPath(new URL('../../../../knowledge', import.meta.url));

function firstObject(value: JsonObject, collectionName: string): JsonObject {
  const collection = value[collectionName];
  const first = Array.isArray(collection) ? collection[0] : undefined;
  if (first === null || typeof first !== 'object' || Array.isArray(first)) {
    throw new TypeError(`Expected a Developer ${collectionName} fixture.`);
  }
  return first;
}

describe('application structured output diagnostics', () => {
  it(
    'keeps opt-in diagnostics in the local logger and out of results, repository, observability and HTTP projections',
    { timeout: 10_000 },
    async () => {
      const invalidSpecification = structuredClone(
        createTechnicalSpecification(),
      ) as unknown as JsonObject;
      firstObject(invalidSpecification, 'modules')['path'] = '/PRIVATE_ABSOLUTE_PATH';
      firstObject(invalidSpecification, 'implementationPhases')['order'] =
        Number.MAX_SAFE_INTEGER + 1;
      const provider = new FakeAIProvider([
        {
          type: 'success',
          response: createProductOwnerAIResponse(createProductOwnerSpecification()),
        },
        {
          type: 'success',
          response: createDeveloperAIResponse(createTechnicalSpecification(), {
            content: JSON.stringify(invalidSpecification),
            structuredData: invalidSpecification,
          }),
        },
      ]);
      const repository = createInMemoryExecutionRecordRepository();
      const history = createInMemoryExecutionHistory({ now: () => 0 });
      const { logger, records } = capturedLogger();
      let time = 0;
      const engine = await createApplicationRuntime({
        aiProvider: provider,
        environment: {
          NODE_ENV: 'development',
          AI_FACTORY_STRUCTURED_OUTPUT_DEBUG: 'true',
        },
        knowledgeRoot: KNOWLEDGE_ROOT,
        executionHistory: history,
        executionRepository: repository,
        logger,
        now: () => ++time,
      });
      const request = executionRequestSchema.parse({
        ...executionBody(),
        requestId: FIXED_REQUEST_ID,
      });

      const result = await engine.execute(request);

      expect(result.status).toBe('FAILED');
      expect(provider.calls).toHaveLength(2);
      const diagnosticRecords = records.filter(
        ({ event }) => event === 'response.validation.structured_output_debug',
      );
      expect(diagnosticRecords).toHaveLength(1);
      expect(diagnosticRecords[0]).toMatchObject({
        level: 'debug',
        diagnosticVersion: '1.0.0',
        issueCount: 2,
        contract: {
          id: 'contract:developer-technical-specification',
          version: '1.0.2',
          contractHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          schemaHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        responseHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        issues: [
          {
            code: 'SCHEMA_MISMATCH',
            instancePath: '/modules/0/path',
            keyword: 'pattern',
            foundType: 'STRING',
          },
          {
            code: 'SCHEMA_MISMATCH',
            instancePath: '/implementationPhases/0/order',
            keyword: 'maximum',
            foundType: 'INTEGER',
          },
        ],
      });

      const persisted = await repository.findByExecutionId(result.executionId);
      expect(persisted).not.toBeNull();
      const publicProjection = toExecutionHistoryDetail(persisted!);
      const privateLog = JSON.stringify(diagnosticRecords);
      const nonDiagnosticSurfaces = JSON.stringify({
        result,
        persisted,
        history: history.get(result.executionId),
        publicProjection,
      });

      expect(privateLog).not.toContain('PRIVATE_ABSOLUTE_PATH');
      expect(privateLog).not.toContain(String(Number.MAX_SAFE_INTEGER + 1));
      expect(privateLog).not.toContain('"schema":');
      expect(nonDiagnosticSurfaces).not.toContain('diagnosticVersion');
      expect(nonDiagnosticSurfaces).not.toContain('sanitizedMessage');
      expect(nonDiagnosticSurfaces).not.toContain('foundType');
      expect(nonDiagnosticSurfaces).not.toContain('response.validation.structured_output_debug');
    },
  );
});
