import { describe, expect, it, vi } from 'vitest';

import { createAdaptiveOrchestrator } from './adaptive-orchestrator';
import { AdaptiveOrchestratorError } from './errors';
import type {
  AdaptiveBuilder,
  AdaptivePlanner,
  AdaptiveReviewer,
  DeterministicVerifier,
  VerifierPortResult,
} from './contracts';
import {
  codeFailureFixture,
  createAdaptiveRequestFixture,
  createBuilderResultFixture,
  createPlannerResultFixture,
  infraFailureFixture,
  successfulVerificationFixture,
} from './testing/fixtures';

function verifierReturning(...results: readonly VerifierPortResult[]): DeterministicVerifier {
  let index = 0;
  return {
    verify: vi.fn(async () => results[Math.min(index++, results.length - 1)]!),
  };
}

describe('Adaptive Orchestrator', () => {
  it('bypasses Planner for a simple greenfield demand and preserves original Builder context', async () => {
    const request = createAdaptiveRequestFixture();
    const planner: AdaptivePlanner = { plan: vi.fn(async () => createPlannerResultFixture()) };
    const builder: AdaptiveBuilder = {
      build: vi.fn(async () => createBuilderResultFixture()),
    };
    const verifier = verifierReturning(successfulVerificationFixture());
    const orchestrator = createAdaptiveOrchestrator({
      planner,
      builder,
      verifier,
      maxRepairAttempts: 0,
    });

    const result = await orchestrator.execute(request);

    expect(result.status).toBe('SUCCESS');
    expect(result.route).toBe('SIMPLE_GREENFIELD');
    expect(result.plan).toBeNull();
    expect(planner.plan).not.toHaveBeenCalled();
    expect(builder.build).toHaveBeenCalledExactlyOnceWith({
      demand: request.demand,
      profile: request.profile,
      plan: null,
      feedback: null,
    });
    expect(result.ledger.calls).toEqual({
      classifier: 1,
      planner: 0,
      builder: 1,
      verifier: 1,
      reviewer: 0,
    });
    expect(result.ledger.tokens.total).toEqual({
      inputTokens: 23,
      outputTokens: 17,
      totalTokens: 40,
    });
    expect(result.ledger.tokens.verifier.totalTokens).toBe(0);
  });

  it('uses Planner only for explicit complex/change signals and reports role tokens', async () => {
    const request = createAdaptiveRequestFixture({
      deliveryIntent: 'CHANGE',
      affectedComponentCount: 3,
    });
    const planner: AdaptivePlanner = { plan: vi.fn(async () => createPlannerResultFixture()) };
    const builder: AdaptiveBuilder = { build: vi.fn(async () => createBuilderResultFixture()) };
    const verifier = verifierReturning(successfulVerificationFixture());
    const orchestrator = createAdaptiveOrchestrator({
      planner,
      builder,
      verifier,
      maxRepairAttempts: 0,
    });

    const result = await orchestrator.execute(request);

    expect(result.status).toBe('SUCCESS');
    expect(result.route).toBe('PLANNED');
    expect(result.plan?.steps).toEqual(createPlannerResultFixture().steps);
    expect(planner.plan).toHaveBeenCalledExactlyOnceWith({
      demand: request.demand,
      profile: request.profile,
      routingSignals: request.routingSignals,
    });
    expect(builder.build).toHaveBeenCalledWith(
      expect.objectContaining({
        demand: request.demand,
        profile: request.profile,
        plan: result.plan,
      }),
    );
    expect(result.ledger.calls.planner).toBe(1);
    expect(result.ledger.tokens.planner.totalTokens).toBe(18);
    expect(result.ledger.tokens.total.totalTokens).toBe(58);
  });

  it('repairs only CODE_FAILURE and stops at the configured hard limit of two', async () => {
    const builder: AdaptiveBuilder = { build: vi.fn(async () => createBuilderResultFixture('c')) };
    const reviewer: AdaptiveReviewer = {
      repair: vi
        .fn()
        .mockResolvedValueOnce(createBuilderResultFixture('d'))
        .mockResolvedValueOnce(createBuilderResultFixture('e')),
    };
    const verifier = verifierReturning(
      codeFailureFixture(),
      codeFailureFixture(),
      codeFailureFixture(),
    );
    const orchestrator = createAdaptiveOrchestrator({
      builder,
      verifier,
      reviewer,
      maxRepairAttempts: 2,
    });

    const result = await orchestrator.execute(createAdaptiveRequestFixture());

    expect(result.status).toBe('FAILED');
    expect(result.diagnostic).toEqual(codeFailureFixture().diagnostic);
    expect(builder.build).toHaveBeenCalledTimes(1);
    expect(reviewer.repair).toHaveBeenCalledTimes(2);
    expect(verifier.verify).toHaveBeenCalledTimes(3);
    expect(result.ledger.calls.reviewer).toBe(2);
    expect(result.ledger.tokens.reviewer.totalTokens).toBe(80);
    expect(reviewer.repair).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        feedback: codeFailureFixture().diagnostic,
        repairAttempt: 1,
      }),
    );
  });

  it('stops repairing as soon as deterministic verification succeeds', async () => {
    const reviewer: AdaptiveReviewer = {
      repair: vi.fn(async () => createBuilderResultFixture('d')),
    };
    const verifier = verifierReturning(codeFailureFixture(), successfulVerificationFixture());
    const orchestrator = createAdaptiveOrchestrator({
      builder: { build: vi.fn(async () => createBuilderResultFixture()) },
      verifier,
      reviewer,
      maxRepairAttempts: 2,
    });

    const result = await orchestrator.execute(createAdaptiveRequestFixture());

    expect(result.status).toBe('SUCCESS');
    expect(reviewer.repair).toHaveBeenCalledTimes(1);
    expect(verifier.verify).toHaveBeenCalledTimes(2);
  });

  it('returns an immutable RESUMABLE checkpoint on infra failure and resumes with zero new AI', async () => {
    const request = createAdaptiveRequestFixture();
    const builder: AdaptiveBuilder = { build: vi.fn(async () => createBuilderResultFixture()) };
    const reviewer: AdaptiveReviewer = {
      repair: vi.fn(async () => createBuilderResultFixture('d')),
    };
    const verifier = verifierReturning(infraFailureFixture(), successfulVerificationFixture());
    const orchestrator = createAdaptiveOrchestrator({
      builder,
      verifier,
      reviewer,
      maxRepairAttempts: 1,
    });

    const interrupted = await orchestrator.execute(request);
    expect(interrupted.status).toBe('RESUMABLE');
    if (interrupted.status !== 'RESUMABLE') throw new Error('Expected resumable result.');
    expect(Object.isFrozen(interrupted.checkpoint)).toBe(true);
    expect(reviewer.repair).not.toHaveBeenCalled();

    const resumed = await orchestrator.resume(interrupted.checkpoint);

    expect(resumed.status).toBe('SUCCESS');
    expect(builder.build).toHaveBeenCalledTimes(1);
    expect(reviewer.repair).not.toHaveBeenCalled();
    expect(verifier.verify).toHaveBeenCalledTimes(2);
    expect(resumed.ledger.tokens).toEqual(interrupted.ledger.tokens);
    expect(resumed.ledger.calls).toEqual({
      ...interrupted.ledger.calls,
      verifier: interrupted.ledger.calls.verifier + 1,
    });
  });

  it('keeps repeated infrastructure resumes verifier-only', async () => {
    const builder: AdaptiveBuilder = { build: vi.fn(async () => createBuilderResultFixture()) };
    const verifier = verifierReturning(infraFailureFixture(), infraFailureFixture());
    const orchestrator = createAdaptiveOrchestrator({ builder, verifier, maxRepairAttempts: 0 });
    const first = await orchestrator.execute(createAdaptiveRequestFixture());
    if (first.status !== 'RESUMABLE') throw new Error('Expected resumable result.');

    const second = await orchestrator.resume(first.checkpoint);

    expect(second.status).toBe('RESUMABLE');
    if (second.status !== 'RESUMABLE') throw new Error('Expected resumable result.');
    expect(second.checkpoint.checkpointHash).not.toBe(first.checkpoint.checkpointHash);
    expect(builder.build).toHaveBeenCalledTimes(1);
    expect(second.ledger.tokens.total.totalTokens).toBe(40);
  });

  it('fails closed for invalid requests, missing Planner, invalid port output, and unsafe policy', async () => {
    expect(() =>
      createAdaptiveOrchestrator({
        builder: { build: vi.fn() },
        verifier: { verify: vi.fn() },
        maxRepairAttempts: 3,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'ADAPTIVE_ORCHESTRATOR_INVALID_CONFIGURATION' }),
    );

    const simple = createAdaptiveOrchestrator({
      builder: { build: vi.fn(async () => createBuilderResultFixture()) },
      verifier: verifierReturning(successfulVerificationFixture()),
      maxRepairAttempts: 0,
    });
    await expect(
      simple.execute({ ...createAdaptiveRequestFixture(), leakedField: true } as never),
    ).rejects.toMatchObject({ code: 'ADAPTIVE_ORCHESTRATOR_INVALID_REQUEST' });
    await expect(
      simple.execute(createAdaptiveRequestFixture({ deliveryIntent: 'CHANGE' })),
    ).rejects.toMatchObject({
      code: 'ADAPTIVE_ORCHESTRATOR_PLANNER_REQUIRED',
      role: 'PLANNER',
    });

    const invalidBuilder = createAdaptiveOrchestrator({
      builder: { build: vi.fn(async () => ({ prompt: 'secret' }) as never) },
      verifier: verifierReturning(successfulVerificationFixture()),
      maxRepairAttempts: 0,
    });
    await expect(invalidBuilder.execute(createAdaptiveRequestFixture())).rejects.toMatchObject({
      code: 'ADAPTIVE_ORCHESTRATOR_INVALID_PORT_RESULT',
      role: 'BUILDER',
    });
  });

  it('rejects tampered checkpoints and policy drift without invoking any port', async () => {
    const verifier = verifierReturning(infraFailureFixture());
    const orchestrator = createAdaptiveOrchestrator({
      builder: { build: vi.fn(async () => createBuilderResultFixture()) },
      verifier,
      maxRepairAttempts: 0,
    });
    const result = await orchestrator.execute(createAdaptiveRequestFixture());
    if (result.status !== 'RESUMABLE') throw new Error('Expected resumable result.');
    const callsBefore = vi.mocked(verifier.verify).mock.calls.length;

    await expect(
      orchestrator.resume({
        ...result.checkpoint,
        candidate: { ...result.checkpoint.candidate, bundleHash: 'f'.repeat(64) },
      }),
    ).rejects.toMatchObject({ code: 'ADAPTIVE_ORCHESTRATOR_CHECKPOINT_INVALID' });
    expect(verifier.verify).toHaveBeenCalledTimes(callsBefore);

    const reviewer: AdaptiveReviewer = {
      repair: vi.fn(async () => createBuilderResultFixture('d')),
    };
    const changedPolicy = createAdaptiveOrchestrator({
      builder: { build: vi.fn(async () => createBuilderResultFixture()) },
      verifier,
      reviewer,
      maxRepairAttempts: 1,
    });
    await expect(changedPolicy.resume(result.checkpoint)).rejects.toMatchObject({
      code: 'ADAPTIVE_ORCHESTRATOR_CHECKPOINT_POLICY_MISMATCH',
    });
  });

  it('does not propagate provider exceptions or sensitive content into public diagnostics', async () => {
    const secret = 'sk-secret-provider-output';
    const failedPort = createAdaptiveOrchestrator({
      builder: {
        build: vi.fn(async () => {
          throw new Error(secret);
        }),
      },
      verifier: verifierReturning(successfulVerificationFixture()),
      maxRepairAttempts: 0,
    });
    let captured: unknown;
    try {
      await failedPort.execute(createAdaptiveRequestFixture());
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(AdaptiveOrchestratorError);
    expect(JSON.stringify(captured)).not.toContain(secret);

    const infra = createAdaptiveOrchestrator({
      builder: { build: vi.fn(async () => createBuilderResultFixture()) },
      verifier: verifierReturning(infraFailureFixture()),
      maxRepairAttempts: 0,
    });
    const result = await infra.execute({
      ...createAdaptiveRequestFixture(),
      demand: { text: secret, additionalContext: 'private-context' },
    });
    expect(result.status).toBe('RESUMABLE');
    expect(JSON.stringify(result.diagnostic)).toBe(
      '{"kind":"INFRA_FAILURE","stage":"RUNTIME","reasonCode":"RUNTIME_TIMEOUT"}',
    );
    expect(JSON.stringify(result.diagnostic)).not.toContain(secret);
  });
});
