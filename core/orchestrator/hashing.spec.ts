import { describe, expect, it } from 'vitest';

import { canonicalizeJson, normalizeJson } from './canonical-json';
import { calculateCanonicalJsonHash, calculateKnowledgeHash } from './hashing';

describe('Orchestrator deterministic hashing', () => {
  it('ordena chaves recursivamente sem alterar arrays ou a entrada', () => {
    const input = { z: [{ b: 2, a: 1 }], a: true };
    const snapshot = structuredClone(input);
    expect(canonicalizeJson(normalizeJson(input))).toBe('{"a":true,"z":[{"a":1,"b":2}]}');
    expect(input).toEqual(snapshot);
  });

  it('produz hashes iguais para objetos semanticamente equivalentes', () => {
    expect(calculateCanonicalJsonHash({ b: 2, a: 1 })).toBe(
      calculateCanonicalJsonHash({ a: 1, b: 2 }),
    );
    expect(calculateKnowledgeHash({ a: 1 })).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('rejeita números não finitos e estruturas cíclicas', () => {
    expect(() => calculateCanonicalJsonHash({ value: Number.NaN })).toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => calculateCanonicalJsonHash(cyclic)).toThrow();
  });
});
