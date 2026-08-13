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
import { ExecutionEngineError, executionRequestSchema } from '@brq/execution-engine';
import { createInMemoryExecutionHistory } from '@brq/observability';
import { GREENFIELD_DELIVERY_INTENT } from '@brq/shared/constants/delivery-intent';
import { describe, expect, it } from 'vitest';

import { capturedLogger, executionBody, FIXED_REQUEST_ID } from '../test/api-fixtures';
import { createApplicationRuntime } from './runtime';

const KNOWLEDGE_ROOT = fileURLToPath(new URL('../../../../knowledge', import.meta.url));

describe('application observability integration', () => {
  it(
    'records the real multi-agent workflow with only FakeAIProvider and minimized metadata',
    { timeout: 20_000 },
    async () => {
      const provider = new FakeAIProvider([
        {
          type: 'success',
          response: createProductOwnerAIResponse(createProductOwnerSpecification(), {
            model: 'gpt-5-mini',
          }),
        },
        {
          type: 'success',
          response: createDeveloperAIResponse(createTechnicalSpecification(), {
            model: 'gpt-5-mini',
          }),
        },
      ]);
      const { logger } = capturedLogger();
      let time = 0;
      const now = (): number => ++time;
      const history = createInMemoryExecutionHistory({ now });
      const engine = await createApplicationRuntime({
        aiProvider: provider,
        environment: { NODE_ENV: 'test' },
        knowledgeRoot: KNOWLEDGE_ROOT,
        executionHistory: history,
        logger,
        now,
      });
      const request = executionRequestSchema.parse({
        ...executionBody(),
        requestId: FIXED_REQUEST_ID,
        deliveryIntent: GREENFIELD_DELIVERY_INTENT,
      });

      const result = await engine.execute(request);
      const snapshot = history.get(result.executionId);

      expect(result.status).toBe('SUCCESS');
      expect(provider.calls).toHaveLength(2);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.status).toBe('SUCCESS');
      expect(snapshot?.stages.map((stage) => stage.status)).toEqual([
        'SUCCESS',
        'SUCCESS',
        'SUCCESS',
        'SUCCESS',
      ]);
      const stageResultKeys = ['productOwner', 'developer', 'qa'] as const;
      snapshot?.stageMetrics.forEach((metrics, index) => {
        const key = stageResultKeys[index]!;
        const agentResult = result.workflowResult?.results[key];
        expect(agentResult).not.toBeNull();
        expect(metrics).toEqual({
          stageId: metrics.stageId,
          durationMs: result.workflowResult?.metrics.observed.stageDurationsMs[key],
          promptBytes: agentResult!.metadata.run.prompt.budget.usedBytes,
          completionBytes: agentResult!.metadata.run.metrics.observed.bytesReceived,
          inputTokens: agentResult!.metadata.run.metrics.reported.usage.inputTokens,
          outputTokens: agentResult!.metadata.run.metrics.reported.usage.outputTokens,
          totalTokens:
            agentResult!.metadata.run.metrics.reported.usage.inputTokens +
            agentResult!.metadata.run.metrics.reported.usage.outputTokens,
          providerLatencyMs: agentResult!.metadata.run.metrics.observed.providerDurationMs,
          validationDurationMs: expect.any(Number),
          artifactGenerationDurationMs: expect.any(Number),
        });
      });
      expect(snapshot?.stageMetrics[2]).toMatchObject({
        stageId: 'QA',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        providerLatencyMs: 0,
      });
      expect(snapshot?.summary).toMatchObject({
        workflowStatus: 'SUCCESS',
        hashes: result.hashes,
        totalDurationMs: result.metrics.observed.totalDurationMs,
        totalCostEstimate: null,
        skippedStages: [],
      });
      expect(history.get(request.workflowId)).toBeNull();

      const serialized = JSON.stringify(snapshot);
      expect(serialized).not.toContain(request.demand.title);
      expect(serialized).not.toContain(request.demand.description);
      expect(serialized).not.toContain('"specification":');
      expect(serialized).not.toContain('"artifacts":');
      expect(serialized).not.toContain('"prompt":');
    },
  );

  it(
    'consolidates a functional failure and skips QA without a real provider',
    { timeout: 10_000 },
    async () => {
      const provider = new FakeAIProvider([
        {
          type: 'success',
          response: createProductOwnerAIResponse(createProductOwnerSpecification(), {
            model: 'gpt-5-mini',
          }),
        },
        { type: 'malformed_json' },
      ]);
      const { logger } = capturedLogger();
      let time = 0;
      const now = (): number => ++time;
      const history = createInMemoryExecutionHistory({ now });
      const engine = await createApplicationRuntime({
        aiProvider: provider,
        environment: { NODE_ENV: 'test' },
        knowledgeRoot: KNOWLEDGE_ROOT,
        executionHistory: history,
        logger,
        now,
      });
      const request = executionRequestSchema.parse({
        ...executionBody(),
        requestId: FIXED_REQUEST_ID,
        deliveryIntent: GREENFIELD_DELIVERY_INTENT,
      });

      const result = await engine.execute(request);
      const snapshot = history.get(result.executionId);

      expect(result.status).toBe('FAILED');
      expect(provider.calls).toHaveLength(2);
      expect(snapshot?.stages.map((stage) => stage.status)).toEqual([
        'SUCCESS',
        'SUCCESS',
        'FAILED',
        'SKIPPED',
      ]);
      expect(snapshot?.stageMetrics[2]).toMatchObject({
        stageId: 'QA',
        durationMs: null,
        totalTokens: null,
      });
      expect(snapshot?.summary).toMatchObject({
        workflowStatus: 'FAILED',
        hashes: result.hashes,
        executedStages: ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER'],
        skippedStages: ['QA'],
        totalCostEstimate: null,
      });
      expect(history.get(request.workflowId)).toBeNull();
      const serialized = JSON.stringify(snapshot);
      expect(serialized).not.toContain(request.demand.title);
      expect(serialized).not.toContain(request.demand.description);
      expect(serialized).not.toContain('Unexpected token');
    },
  );

  it(
    'records cancellation before workflow start from the public Engine error result',
    { timeout: 10_000 },
    async () => {
      const provider = new FakeAIProvider();
      const { logger } = capturedLogger();
      let time = 0;
      const now = (): number => ++time;
      const history = createInMemoryExecutionHistory({ now });
      const engine = await createApplicationRuntime({
        aiProvider: provider,
        environment: { NODE_ENV: 'test' },
        knowledgeRoot: KNOWLEDGE_ROOT,
        executionHistory: history,
        logger,
        now,
      });
      const request = executionRequestSchema.parse({
        ...executionBody(),
        requestId: FIXED_REQUEST_ID,
        deliveryIntent: GREENFIELD_DELIVERY_INTENT,
      });
      const controller = new AbortController();
      controller.abort();

      const caught = await engine
        .execute(request, { signal: controller.signal })
        .catch((error) => error);

      expect(caught).toBeInstanceOf(ExecutionEngineError);
      const result = (caught as ExecutionEngineError).result;
      expect(result?.status).toBe('CANCELLED');
      expect(provider.calls).toHaveLength(0);
      const snapshot = history.get(result!.executionId);
      expect(snapshot?.status).toBe('CANCELLED');
      expect(snapshot?.stages.every((stage) => stage.status === 'SKIPPED')).toBe(true);
      expect(snapshot?.stageMetrics.every((metrics) => metrics.totalTokens === null)).toBe(true);
      expect(snapshot?.summary).toMatchObject({
        workflowStatus: 'CANCELLED',
        hashes: result!.hashes,
        executedStages: [],
        skippedStages: ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA'],
        totalTokens: 0,
        totalCostEstimate: null,
      });
      expect(history.get(request.workflowId)).toBeNull();
    },
  );
});
