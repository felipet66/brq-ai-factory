import { describe, expect, it } from 'vitest';

import { canonicalizeJson } from './canonical-json';

describe('canonicalizeJson', () => {
  it('sorts object keys recursively', () => {
    expect(
      canonicalizeJson({
        zebra: 1,
        alpha: {
          delta: true,
          beta: null,
        },
      }),
    ).toBe('{"alpha":{"beta":null,"delta":true},"zebra":1}');
  });

  it('preserves array order while canonicalizing nested objects', () => {
    const first = canonicalizeJson([{ z: 1, a: 2 }, 'middle', { c: 3, b: 4 }]);
    const second = canonicalizeJson([{ c: 3, b: 4 }, 'middle', { z: 1, a: 2 }]);

    expect(first).toBe('[{"a":2,"z":1},"middle",{"b":4,"c":3}]');
    expect(second).not.toBe(first);
  });

  it('produces the same representation for objects with different insertion order', () => {
    const left = canonicalizeJson({ outer: { first: 1, second: 2 }, value: 'stable' });
    const right = canonicalizeJson({ value: 'stable', outer: { second: 2, first: 1 } });

    expect(left).toBe(right);
  });

  it('does not mutate the supplied value', () => {
    const value = {
      z: [{ b: 2, a: 1 }],
      a: 'first',
    };
    const snapshot = structuredClone(value);

    canonicalizeJson(value);

    expect(value).toEqual(snapshot);
    expect(Object.keys(value)).toEqual(['z', 'a']);
  });

  it('serializes JSON primitives with their native JSON representation', () => {
    expect(canonicalizeJson(null)).toBe('null');
    expect(canonicalizeJson(true)).toBe('true');
    expect(canonicalizeJson(42.5)).toBe('42.5');
    expect(canonicalizeJson('line\n"quoted"')).toBe('"line\\n\\"quoted\\""');
  });

  it('rejects non-finite numbers received at runtime', () => {
    expect(() => canonicalizeJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalizeJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('rejects cyclic values received at runtime', () => {
    const value: Record<string, unknown> = {};
    value.self = value;

    expect(() => canonicalizeJson(value as never)).toThrow(TypeError);
  });
});
