import { describe, expect, it } from 'vitest';

import { calculateCanonicalJsonHash, createDeterministicExecutionId } from './hashing';

describe('Execution Engine hashing', () => {
  it('canoniza propriedades e cria executionId determinístico versionado', () => {
    const firstHash = calculateCanonicalJsonHash({ workflowId: 'workflow-001', value: 1 });
    const secondHash = calculateCanonicalJsonHash({ value: 1, workflowId: 'workflow-001' });

    expect(firstHash).toBe(secondHash);
    expect(createDeterministicExecutionId(firstHash, '1.0.0')).toBe(
      createDeterministicExecutionId(secondHash, '1.0.0'),
    );
    expect(createDeterministicExecutionId(firstHash, '1.0.0')).toMatch(/^execution-[a-f0-9]{32}$/);
    expect(createDeterministicExecutionId(firstHash, '2.0.0')).not.toBe(
      createDeterministicExecutionId(firstHash, '1.0.0'),
    );
  });

  it('rejeita valores não serializáveis ou não finitos', () => {
    expect(() => calculateCanonicalJsonHash(undefined)).toThrow(TypeError);
    expect(() => calculateCanonicalJsonHash({ value: Number.NaN })).toThrow(TypeError);
  });
});
