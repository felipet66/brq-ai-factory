import { describe, expect, it } from 'vitest';

import { calculateCanonicalJsonHash, calculatePromptHash } from './hashing';

describe('calculatePromptHash', () => {
  it('calculates a lowercase SHA-256 hexadecimal digest for text', () => {
    expect(calculatePromptHash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes exact UTF-8 bytes consistently', () => {
    const value = 'conteúdo seguro';

    expect(calculatePromptHash(value)).toBe(calculatePromptHash(new TextEncoder().encode(value)));
  });

  it('distinguishes byte sequences without normalizing content', () => {
    expect(calculatePromptHash('line\n')).not.toBe(calculatePromptHash('line\r\n'));
  });
});

describe('calculateCanonicalJsonHash', () => {
  it('ignores object insertion order', () => {
    expect(calculateCanonicalJsonHash({ alpha: 1, beta: { x: true, y: false } })).toBe(
      calculateCanonicalJsonHash({ beta: { y: false, x: true }, alpha: 1 }),
    );
  });

  it('preserves semantically relevant array order', () => {
    expect(calculateCanonicalJsonHash(['first', 'second'])).not.toBe(
      calculateCanonicalJsonHash(['second', 'first']),
    );
  });
});
