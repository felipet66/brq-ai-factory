import { describe, expect, it } from 'vitest';

import type { KnowledgeSource } from '../knowledge-source';

export interface KnowledgeSourceContractFixture {
  content: string;
  dispose?: () => Promise<void>;
  locator: string;
  source: KnowledgeSource;
}

export function defineKnowledgeSourceContract(
  name: string,
  createFixture: () => Promise<KnowledgeSourceContractFixture>,
): void {
  describe(`${name} KnowledgeSource contract`, () => {
    it('discovers deterministically and reads an independent byte copy', async () => {
      const fixture = await createFixture();

      try {
        const firstDiscovery = await fixture.source.discover();
        const secondDiscovery = await fixture.source.discover();
        const firstRead = await fixture.source.read(fixture.locator);
        const secondRead = await fixture.source.read(fixture.locator);

        expect(secondDiscovery).toEqual(firstDiscovery);
        expect(firstDiscovery.some((entry) => entry.locator === fixture.locator)).toBe(true);
        expect(new TextDecoder().decode(firstRead)).toBe(fixture.content);
        expect(new TextDecoder().decode(secondRead)).toBe(fixture.content);
        expect(secondRead).not.toBe(firstRead);
      } finally {
        await fixture.dispose?.();
      }
    });
  });
}
