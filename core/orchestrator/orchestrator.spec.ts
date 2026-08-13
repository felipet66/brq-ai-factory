import {
  DEVELOPER_AGENT_ERROR_CODES,
  DeveloperAgentError,
  type DeveloperAgent,
} from '@brq/developer-agent';
import type { ProductOwnerAgent } from '@brq/product-owner-agent';
import type { QAAgent } from '@brq/qa-agent';
import { CHANGE_DELIVERY_INTENT } from '@brq/shared/constants/delivery-intent';
import { createLogger } from '@brq/shared/logger/logger';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { CreateOrchestratorOptions, WorkflowRequest } from './contracts';
import { ORCHESTRATOR_ERROR_CODES, OrchestratorError } from './errors';
import { createOrchestrator } from './orchestrator';
import {
  createOrchestratorAgentResultFixtures,
  createWorkflowRequestFixture,
  type OrchestratorAgentResultFixtures,
} from './testing/orchestrator-fixtures';

function clock(start = 0, step = 10): () => number {
  let value = start;
  return () => {
    value += step;
    return value;
  };
}

function agents(fixtures: OrchestratorAgentResultFixtures['generated'], calls: string[] = []) {
  const productOwnerAgent: ProductOwnerAgent = {
    execute: vi.fn(async () => {
      calls.push('PRODUCT_OWNER');
      return fixtures.productOwner;
    }),
  };
  const developerAgent: DeveloperAgent = {
    execute: vi.fn(async () => {
      calls.push('DEVELOPER');
      return fixtures.developer;
    }),
  };
  const qaAgent: QAAgent = {
    execute: vi.fn(async () => {
      calls.push('QA');
      return fixtures.qa;
    }),
  };
  return { productOwnerAgent, developerAgent, qaAgent };
}

function options(
  agentOptions: ReturnType<typeof agents>,
  overrides: Partial<CreateOrchestratorOptions> = {},
): CreateOrchestratorOptions {
  return {
    ...agentOptions,
    logger: createLogger({ sink: () => undefined }),
    now: clock(),
    ...overrides,
  };
}

describe('Orchestrator', () => {
  let request: WorkflowRequest;
  let fixtures: OrchestratorAgentResultFixtures;

  beforeAll(async () => {
    request = createWorkflowRequestFixture();
    fixtures = await createOrchestratorAgentResultFixtures(request);
  });

  it('coordena exatamente Product Owner → Developer → QA e produz WorkflowResult completo', async () => {
    const calls: string[] = [];
    const ports = agents(fixtures.generated, calls);
    const controller = new AbortController();
    const snapshot = structuredClone(request);
    const orchestrator = createOrchestrator(options(ports));

    const result = await orchestrator.execute(request, {
      signal: controller.signal,
      cacheMode: 'REQUIRE_HIT',
    });

    expect(calls).toEqual(['PRODUCT_OWNER', 'DEVELOPER', 'QA']);
    expect(result.status).toBe('SUCCESS');
    expect(result.contractVersion).toBe('1.1.0');
    expect(result.terminalStage).toBe('FINALIZATION');
    expect(result.completedStages).toEqual(['PRODUCT_OWNER', 'DEVELOPER', 'QA', 'FINALIZATION']);
    expect(result.results.productOwner?.outcome).toBe('GENERATED');
    expect(result.results.developer?.outcome).toBe('GENERATED');
    expect(result.results.qa?.outcome).toBe('GENERATED');
    expect(result.timeline.map(({ event }) => event)).toEqual([
      'WORKFLOW_STARTED',
      'STAGE_STARTED',
      'STAGE_COMPLETED',
      'STAGE_STARTED',
      'STAGE_COMPLETED',
      'STAGE_STARTED',
      'STAGE_COMPLETED',
      'STAGE_STARTED',
      'STAGE_COMPLETED',
      'WORKFLOW_COMPLETED',
    ]);
    expect(result.lineage.handoffs).toHaveLength(3);
    expect(result.provenance.stages).toHaveLength(3);
    expect(result).not.toHaveProperty('lineage.stages');
    expect(result).not.toHaveProperty('provenance.handoffs');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.timeline)).toBe(true);
    expect(request).toEqual(snapshot);

    const productOwnerCall = vi.mocked(ports.productOwnerAgent.execute).mock.calls[0];
    const developerCall = vi.mocked(ports.developerAgent.execute).mock.calls[0];
    const qaCall = vi.mocked(ports.qaAgent.execute).mock.calls[0];
    expect(productOwnerCall?.[0].context.attempt).toBe(1);
    expect(productOwnerCall?.[0].deliveryIntent).toEqual(request.deliveryIntent);
    expect(developerCall?.[0].deliveryIntent).toEqual(request.deliveryIntent);
    expect(developerCall?.[0].productOwnerSpecification).toEqual(
      fixtures.generated.productOwner.specification,
    );
    expect(qaCall?.[0].productOwnerSpecification).toEqual(
      fixtures.generated.productOwner.specification,
    );
    expect(qaCall?.[0].technicalSpecification).toEqual(fixtures.generated.developer.specification);
    expect(qaCall?.[0].deliveryIntent).toEqual(request.deliveryIntent);
    expect(productOwnerCall?.[1]?.signal).toBe(controller.signal);
    expect(developerCall?.[1]?.signal).toBe(controller.signal);
    expect(qaCall?.[1]?.signal).toBe(controller.signal);
    expect(productOwnerCall?.[1]?.cacheMode).toBe('REQUIRE_HIT');
    expect(developerCall?.[1]?.cacheMode).toBe('REQUIRE_HIT');
    expect(qaCall?.[1]?.cacheMode).toBe('REQUIRE_HIT');
  });

  it('mantém hashes determinísticos apesar de timestamps e durações diferentes', async () => {
    const first = await createOrchestrator(
      options(agents(fixtures.generated), { now: clock(0, 5) }),
    ).execute(request);
    const second = await createOrchestrator(
      options(agents(fixtures.generated), { now: clock(1_000, 17) }),
    ).execute(structuredClone(request));

    expect(first.hashes).toEqual(second.hashes);
    expect(first.timeline).not.toEqual(second.timeline);
    expect(first.metrics.observed.totalDurationMs).not.toBe(
      second.metrics.observed.totalDurationMs,
    );
  });

  it('interrompe no Product Owner após rejeição funcional', async () => {
    const ports = agents(fixtures.generated);
    vi.mocked(ports.productOwnerAgent.execute).mockResolvedValue(fixtures.rejected.productOwner);
    const result = await createOrchestrator(options(ports)).execute(request);

    expect(result.status).toBe('FAILED');
    expect(result.failure).toMatchObject({
      kind: 'VALIDATION_REJECTED',
      stage: 'PRODUCT_OWNER',
    });
    expect(result.results.productOwner?.outcome).toBe('VALIDATION_REJECTED');
    expect(result.results.developer).toBeNull();
    expect(result.results.qa).toBeNull();
    expect(ports.developerAgent.execute).not.toHaveBeenCalled();
    expect(ports.qaAgent.execute).not.toHaveBeenCalled();
  });

  it('preserva o Product Owner quando o Developer rejeita funcionalmente', async () => {
    const ports = agents(fixtures.generated);
    vi.mocked(ports.developerAgent.execute).mockResolvedValue(fixtures.rejected.developer);
    const result = await createOrchestrator(options(ports)).execute(request);

    expect(result.status).toBe('FAILED');
    expect(result.failure).toMatchObject({ kind: 'VALIDATION_REJECTED', stage: 'DEVELOPER' });
    expect(result.results.productOwner?.outcome).toBe('GENERATED');
    expect(result.results.developer?.outcome).toBe('VALIDATION_REJECTED');
    expect(result.results.qa).toBeNull();
    expect(ports.qaAgent.execute).not.toHaveBeenCalled();
  });

  it('preserva as duas specifications quando o QA rejeita funcionalmente', async () => {
    const ports = agents(fixtures.generated);
    vi.mocked(ports.qaAgent.execute).mockResolvedValue(fixtures.rejected.qa);
    const result = await createOrchestrator(options(ports)).execute(request);

    expect(result.status).toBe('FAILED');
    expect(result.failure).toMatchObject({ kind: 'VALIDATION_REJECTED', stage: 'QA' });
    expect(result.results.productOwner?.outcome).toBe('GENERATED');
    expect(result.results.developer?.outcome).toBe('GENERATED');
    expect(result.results.qa?.outcome).toBe('VALIDATION_REJECTED');
  });

  it('propaga erro técnico sanitizado com resultado parcial e sem chamar QA', async () => {
    const ports = agents(fixtures.generated);
    vi.mocked(ports.developerAgent.execute).mockRejectedValue(
      new DeveloperAgentError('conteúdo interno', {
        code: DEVELOPER_AGENT_ERROR_CODES.RUN_FAILED,
        stage: 'RUNNER_EXECUTION',
        durationMs: 8,
      }),
    );

    const error = await createOrchestrator(options(ports))
      .execute(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error).toMatchObject({
      code: ORCHESTRATOR_ERROR_CODES.DEVELOPER_FAILED,
      sourceCode: DEVELOPER_AGENT_ERROR_CODES.RUN_FAILED,
      result: {
        status: 'FAILED',
        results: { productOwner: { outcome: 'GENERATED' }, developer: null, qa: null },
      },
    });
    expect(ports.qaAgent.execute).not.toHaveBeenCalled();
  });

  it('propaga cancelamento antes da primeira chamada com WorkflowResult terminal', async () => {
    const ports = agents(fixtures.generated);
    const controller = new AbortController();
    controller.abort();

    const error = await createOrchestrator(options(ports))
      .execute(request, { signal: controller.signal })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error).toMatchObject({
      code: ORCHESTRATOR_ERROR_CODES.CANCELLED,
      result: { status: 'CANCELLED', terminalStage: 'INITIALIZATION' },
    });
    expect(ports.productOwnerAgent.execute).not.toHaveBeenCalled();
    expect(ports.developerAgent.execute).not.toHaveBeenCalled();
    expect(ports.qaAgent.execute).not.toHaveBeenCalled();
  });

  it('rejeita resultado malformado na fronteira pública e preserva a causa fora dos logs', async () => {
    const ports = agents(fixtures.generated);
    vi.mocked(ports.productOwnerAgent.execute).mockResolvedValue({} as never);
    const error = await createOrchestrator(options(ports))
      .execute(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error).toMatchObject({
      code: ORCHESTRATOR_ERROR_CODES.CONTRACT_VIOLATION,
      result: { status: 'FAILED', results: { productOwner: null } },
    });
  });

  it('detecta divergência de lineage antes de aceitar o resultado do Developer', async () => {
    const ports = agents(fixtures.generated);
    vi.mocked(ports.developerAgent.execute).mockResolvedValue(fixtures.mismatchedDeveloper);
    const error = await createOrchestrator(options(ports))
      .execute(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error).toMatchObject({
      code: ORCHESTRATOR_ERROR_CODES.LINEAGE_MISMATCH,
      result: {
        status: 'FAILED',
        results: { productOwner: { outcome: 'GENERATED' }, developer: null, qa: null },
      },
    });
    expect(ports.qaAgent.execute).not.toHaveBeenCalled();
  });

  it('rejeita resultado do Product Owner produzido para outro delivery intent', async () => {
    const changedRequest = createWorkflowRequestFixture({
      deliveryIntent: CHANGE_DELIVERY_INTENT,
    });
    const ports = agents(fixtures.generated);

    const error = await createOrchestrator(options(ports))
      .execute(changedRequest)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error).toMatchObject({
      code: ORCHESTRATOR_ERROR_CODES.LINEAGE_MISMATCH,
      result: { status: 'FAILED', results: { productOwner: null, developer: null, qa: null } },
    });
    expect(ports.developerAgent.execute).not.toHaveBeenCalled();
  });

  it('captures Product Owner correlation before an untrusted port can mutate its request', async () => {
    const changedRequest = createWorkflowRequestFixture({
      deliveryIntent: CHANGE_DELIVERY_INTENT,
    });
    const ports = agents(fixtures.generated);
    vi.mocked(ports.productOwnerAgent.execute).mockImplementation(async (agentRequest) => {
      (agentRequest.deliveryIntent as { mode: 'GREENFIELD' | 'CHANGE' }).mode = 'GREENFIELD';
      return fixtures.generated.productOwner;
    });

    const error = await createOrchestrator(options(ports))
      .execute(changedRequest)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error).toMatchObject({
      code: ORCHESTRATOR_ERROR_CODES.LINEAGE_MISMATCH,
      result: { status: 'FAILED', results: { productOwner: null, developer: null, qa: null } },
    });
    expect(ports.developerAgent.execute).not.toHaveBeenCalled();
  });

  it('rejeita resultado do Developer produzido para outro delivery intent', async () => {
    const changedRequest = createWorkflowRequestFixture({
      deliveryIntent: CHANGE_DELIVERY_INTENT,
    });
    const changedFixtures = await createOrchestratorAgentResultFixtures(changedRequest);
    const ports = agents(changedFixtures.generated);
    vi.mocked(ports.developerAgent.execute).mockResolvedValue(fixtures.generated.developer);

    const error = await createOrchestrator(options(ports))
      .execute(changedRequest)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error).toMatchObject({
      code: ORCHESTRATOR_ERROR_CODES.LINEAGE_MISMATCH,
      result: {
        status: 'FAILED',
        results: { productOwner: { outcome: 'GENERATED' }, developer: null, qa: null },
      },
    });
    expect(ports.qaAgent.execute).not.toHaveBeenCalled();
  });

  it('não inclui conteúdo do usuário, specifications ou artifacts nos logs', async () => {
    const logLines: string[] = [];
    const sensitiveRequest = createWorkflowRequestFixture({
      demand: {
        ...request.demand,
        description: 'SENTINEL_USER_CONTENT',
      },
    });
    const sensitiveFixtures = await createOrchestratorAgentResultFixtures(sensitiveRequest);
    await createOrchestrator(
      options(agents(sensitiveFixtures.generated), {
        logger: createLogger({ sink: (line) => logLines.push(line) }),
      }),
    ).execute(sensitiveRequest);

    const logs = logLines.join('\n');
    expect(logs).not.toContain('SENTINEL_USER_CONTENT');
    expect(logs).not.toContain(sensitiveFixtures.generated.productOwner.specification.title);
    expect(logs).not.toContain(
      sensitiveFixtures.generated.productOwner.artifacts[0]?.draft.content,
    );
    expect(logs).not.toContain('"promptHash"');
  });

  it('rejeita configuração inválida sem iniciar workflow', () => {
    expect(() =>
      createOrchestrator({
        productOwnerAgent: {} as ProductOwnerAgent,
        developerAgent: {} as DeveloperAgent,
        qaAgent: {} as QAAgent,
      }),
    ).toThrowError(
      expect.objectContaining({ code: ORCHESTRATOR_ERROR_CODES.INVALID_CONFIGURATION }),
    );
  });
});
