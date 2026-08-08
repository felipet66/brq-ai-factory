// @vitest-environment node

import {
  PROMPT_INSPECTOR_ERROR_CODES,
  promptInspectionCatalogSchema,
  promptInspectionPreviewResultSchema,
  promptInspectionValidationResultSchema,
  type PromptInspector,
} from '@brq/prompt-inspector';
import { beforeAll, describe, expect, it } from 'vitest';

import { capturedLogger } from '@/test/api-fixtures';

import { createPlaygroundRuntime } from './prompt-inspection-runtime';

describe('inspection-only Playground runtime', () => {
  const captured = capturedLogger();
  let inspector: PromptInspector;

  beforeAll(async () => {
    inspector = await createPlaygroundRuntime({
      environment: { NODE_ENV: 'test' },
      logger: captured.logger,
    });
  });

  it('publishes fixed PO, Developer and QA adapters with synthetic validated examples', () => {
    const catalog = promptInspectionCatalogSchema.parse(inspector.catalog());

    expect(catalog.retention).toBe('EPHEMERAL');
    expect(catalog.agents.map(({ agent }) => agent)).toEqual(['PRODUCT_OWNER', 'DEVELOPER', 'QA']);
    expect(catalog.agents.map(({ versions }) => versions.agentVersion)).toEqual([
      '1.0.0',
      '1.0.0',
      '1.0.0',
    ]);
    expect(catalog.agents.map(({ versions }) => versions.promptVersion)).toEqual([
      '1.0.1',
      '1.0.2',
      '1.0.0',
    ]);
    expect(catalog.agents.every(({ examples }) => examples.length > 0)).toBe(true);
    expect(catalog.agents.every(({ examples }) => examples[0]?.candidate !== undefined)).toBe(true);
  });

  it('builds real previews for all agents with runtime budget, hashes and derived trust boundaries', async () => {
    const catalog = inspector.catalog();

    for (const descriptor of catalog.agents) {
      const example = descriptor.examples[0]!;
      const rawResult = await inspector.preview({ agent: descriptor.agent, input: example.input });
      const result = promptInspectionPreviewResultSchema.parse(rawResult);

      expect(result.status).toBe('BUILT');
      if (result.status !== 'BUILT') continue;
      expect(result.retention).toBe('EPHEMERAL');
      expect(result.budget.maxBytes).toBe(512 * 1024);
      expect(result.budget.usedBytes).toBe(
        result.budget.instructionsBytes +
          result.budget.inputBytes +
          result.budget.outputContractBytes,
      );
      expect(result.hashes.promptHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.hashes.templateHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.knowledge.contextHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.knowledge.documents.length).toBeGreaterThan(0);
      expect(
        result.knowledge.documents.every(
          (document) => document.selection === 'REQUIRED' || document.selection === 'OPTIONAL',
        ),
      ).toBe(true);
      expect(result.trustBoundaries.trustedSectionIds.length).toBeGreaterThan(0);
      expect(result.trustBoundaries.untrustedSectionIds.length).toBeGreaterThan(0);
      expect(result.prompt.instructions.length).toBeGreaterThan(0);
      expect(result.prompt.input.length).toBeGreaterThan(0);
      expect(result.outputContract.format).toBe('JSON_SCHEMA');
      expect(result.outputContract.summary.totalNodes).toBeGreaterThan(0);
      expect(result.outputContract.schemaHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('validates every bundled manual candidate through all four stages without a provider', async () => {
    for (const descriptor of inspector.catalog().agents) {
      const example = descriptor.examples[0]!;
      const result = promptInspectionValidationResultSchema.parse(
        await inspector.validate({
          agent: descriptor.agent,
          input: example.input,
          candidate: { content: example.candidate! },
        }),
      );

      expect(result.status).toBe('PASS');
      expect(result.retention).toBe('EPHEMERAL');
      expect(result.stages.map(({ status }) => status)).toEqual(['PASS', 'PASS', 'PASS', 'PASS']);
      expect(result.stages.every(({ issuesTruncated }) => !issuesTruncated)).toBe(true);
    }
  }, 20_000);

  it('is deterministic and keeps lower-component responseHash logs outside the host logger', async () => {
    const descriptor = inspector.catalog().agents[0]!;
    const request = { agent: descriptor.agent, input: descriptor.examples[0]!.input };
    const first = await inspector.preview(request);
    const second = await inspector.preview(request);
    const serializedLogs = JSON.stringify(captured.records);

    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(serializedLogs).not.toContain('responseHash');
    expect(serializedLogs).not.toContain('response.validation');
    expect(serializedLogs).not.toContain(descriptor.examples[0]!.candidate!);
    expect(serializedLogs).not.toContain('Permitir que clientes consultem');
  });

  it('honors an AbortSignal without placing it in the inspection DTO', async () => {
    const descriptor = inspector.catalog().agents[0]!;
    const controller = new AbortController();
    controller.abort();

    await expect(
      inspector.preview(
        { agent: descriptor.agent, input: descriptor.examples[0]!.input },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({
      code: PROMPT_INSPECTOR_ERROR_CODES.CANCELLED,
    });
  });
});
