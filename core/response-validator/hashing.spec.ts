import { describe, expect, it } from 'vitest';

import { canonicalizeJson } from './canonical-json';
import { calculateCanonicalHash, calculateTextHash, utf8ByteLength } from './hashing';

describe('response validator hashing', () => {
  it('canonicalizes object keys while preserving array order', () => {
    const first = { z: 1, nested: { b: true, a: null }, list: [2, 1] };
    const second = { list: [2, 1], nested: { a: null, b: true }, z: 1 };

    expect(canonicalizeJson(first)).toBe(canonicalizeJson(second));
    expect(calculateCanonicalHash(first)).toBe(calculateCanonicalHash(second));
    expect(calculateCanonicalHash({ ...second, list: [1, 2] })).not.toBe(
      calculateCanonicalHash(first),
    );
  });

  it('hashes exact text and measures UTF-8 bytes', () => {
    expect(calculateTextHash(' texto ')).not.toBe(calculateTextHash('texto'));
    expect(utf8ByteLength('á')).toBe(2);
  });
});
