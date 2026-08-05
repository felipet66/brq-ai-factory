import { describe, expect, it } from 'vitest';

import type { PromptResult, ResolvedPromptDocument, ResolvedPromptSection } from './contracts';
import { comparePromptResults } from './prompt-comparator';

function section(id: string, hash = `${id}-hash`): ResolvedPromptSection {
  return { id, hash } as ResolvedPromptSection;
}

function prompt(hash: string, sections: readonly ResolvedPromptSection[]): PromptResult {
  return {
    document: { sections } as ResolvedPromptDocument,
    metadata: { promptHash: hash },
  } as PromptResult;
}

describe('comparePromptResults', () => {
  it('reports equal prompts without changes', () => {
    const result = comparePromptResults(
      prompt('same-hash', [section('global'), section('input')]),
      prompt('same-hash', [section('global'), section('input')]),
    );

    expect(result).toEqual({
      added: [],
      changed: [],
      equal: true,
      promptHashChanged: false,
      removed: [],
      reordered: [],
    });
  });

  it('reports added and removed sections in their document order', () => {
    const result = comparePromptResults(
      prompt('before-hash', [section('removed'), section('shared')]),
      prompt('after-hash', [section('shared'), section('added')]),
    );

    expect(result.added).toEqual([
      { hash: 'added-hash', id: 'added', index: 1, nodeType: 'SECTION', path: ['added'] },
    ]);
    expect(result.removed).toEqual([
      {
        hash: 'removed-hash',
        id: 'removed',
        index: 0,
        nodeType: 'SECTION',
        path: ['removed'],
      },
    ]);
    expect(result.reordered).toEqual([]);
    expect(result.equal).toBe(false);
  });

  it('reports changed sections by stable ID and hash', () => {
    const result = comparePromptResults(
      prompt('before-hash', [section('security', 'old-hash')]),
      prompt('after-hash', [section('security', 'new-hash')]),
    );

    expect(result.changed).toEqual([
      {
        before: {
          hash: 'old-hash',
          id: 'security',
          index: 0,
          nodeType: 'SECTION',
          path: ['security'],
        },
        after: {
          hash: 'new-hash',
          id: 'security',
          index: 0,
          nodeType: 'SECTION',
          path: ['security'],
        },
      },
    ]);
  });

  it('reports reordering independently of section content changes', () => {
    const result = comparePromptResults(
      prompt('before-hash', [section('one'), section('two'), section('three')]),
      prompt('after-hash', [section('three'), section('one'), section('two')]),
    );

    expect(result.changed).toEqual([]);
    expect(result.reordered).toEqual([
      {
        afterIndex: 0,
        beforeIndex: 2,
        hash: 'three-hash',
        id: 'three',
        nodeType: 'SECTION',
        path: ['three'],
      },
      {
        afterIndex: 1,
        beforeIndex: 0,
        hash: 'one-hash',
        id: 'one',
        nodeType: 'SECTION',
        path: ['one'],
      },
      {
        afterIndex: 2,
        beforeIndex: 1,
        hash: 'two-hash',
        id: 'two',
        nodeType: 'SECTION',
        path: ['two'],
      },
    ]);
  });

  it('does not treat index shifts from additions or removals as reordering', () => {
    const result = comparePromptResults(
      prompt('before-hash', [section('removed'), section('one'), section('two')]),
      prompt('after-hash', [section('one'), section('added'), section('two')]),
    );

    expect(result.reordered).toEqual([]);
  });

  it('reports a top-level hash change even when section hashes are unchanged', () => {
    const result = comparePromptResults(
      prompt('before-hash', [section('same')]),
      prompt('after-hash', [section('same')]),
    );

    expect(result).toMatchObject({
      equal: false,
      promptHashChanged: true,
      added: [],
      changed: [],
      removed: [],
      reordered: [],
    });
  });

  it('rejects duplicate section IDs because their comparison would be ambiguous', () => {
    expect(() =>
      comparePromptResults(
        prompt('before-hash', [section('duplicate'), section('duplicate')]),
        prompt('after-hash', [section('duplicate')]),
      ),
    ).toThrow(TypeError);
  });

  it('returns a deeply immutable comparison result', () => {
    const result = comparePromptResults(
      prompt('before-hash', [section('removed')]),
      prompt('after-hash', [section('added')]),
    );

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.added)).toBe(true);
    expect(Object.isFrozen(result.added[0])).toBe(true);
    expect(Object.isFrozen(result.added[0]?.path)).toBe(true);
    expect(Object.isFrozen(result.removed)).toBe(true);
    expect(Object.isFrozen(result.removed[0])).toBe(true);
  });
});
