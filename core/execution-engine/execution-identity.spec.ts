import { describe, expect, it } from 'vitest';

import { deriveExecutionIdentity } from './execution-engine';
import { ExecutionEngineError } from './errors';
import { createExecutionRequestFixture } from './testing/execution-engine-fixtures';

describe('Execution identity reservation', () => {
  it('reserva a mesma identidade determinística usada pelo contrato do Engine', () => {
    const request = createExecutionRequestFixture();

    const first = deriveExecutionIdentity(request);
    const second = deriveExecutionIdentity(structuredClone(request));

    expect(first).toEqual(second);
    expect(first.executionId).toMatch(/^execution-[a-f0-9]{32}$/);
    expect(first.executionRequestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('mantém a identidade sensível ao contrato integral da requisição', () => {
    const request = createExecutionRequestFixture();
    const changed = {
      ...request,
      demand: { ...request.demand, title: `${request.demand.title} v2` },
    };

    expect(deriveExecutionIdentity(changed)).not.toEqual(deriveExecutionIdentity(request));
  });

  it('rejeita uma requisição inválida antes de reservar identidade', () => {
    expect(() =>
      deriveExecutionIdentity({
        ...createExecutionRequestFixture(),
        workflowId: '',
      }),
    ).toThrow(ExecutionEngineError);
  });
});
