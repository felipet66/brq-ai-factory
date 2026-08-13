import { describe, expect, it } from 'vitest';
import { CHANGE_DELIVERY_INTENT } from '@brq/shared/constants/delivery-intent';

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
    expect(first.workflowRequestHash).toMatch(/^[a-f0-9]{64}$/);
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

  it('inclui a intenção imutável de entrega na identidade da execução', () => {
    const request = createExecutionRequestFixture();
    const changeRequest = createExecutionRequestFixture({
      deliveryIntent: CHANGE_DELIVERY_INTENT,
    });

    expect(deriveExecutionIdentity(structuredClone(request))).toEqual(
      deriveExecutionIdentity(request),
    );
    expect(deriveExecutionIdentity(changeRequest)).not.toEqual(deriveExecutionIdentity(request));
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
