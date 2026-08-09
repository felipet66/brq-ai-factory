// @vitest-environment node

import { fileURLToPath } from 'node:url';

import { promptInspectionBuiltPreviewSchema } from '@brq/prompt-inspector';
import { describe, expect, it } from 'vitest';

import { builtPreviewFixture } from '@/components/playground/playground.spec.fixtures';
import { createPlaygroundRuntime } from '@/server/playground/prompt-inspection-runtime';

import { playgroundBuiltPreviewSchema, playgroundPreviewSchema } from './playground-contracts';

const KNOWLEDGE_ROOT = fileURLToPath(new URL('../../../../knowledge', import.meta.url));

describe('Prompt Playground browser contract parity', () => {
  it('accepts serialization and descriptorHash in frontend fixtures and the canonical core contract', () => {
    const fixture = builtPreviewFixture();

    const browserResult = playgroundBuiltPreviewSchema.parse(fixture);

    expect(browserResult.hashes.contextHashes[0]).toMatchObject({
      serialization: 'TEXT',
      descriptorHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(promptInspectionBuiltPreviewSchema.safeParse(fixture).success).toBe(true);
  });

  it('requires descriptorHash instead of silently accepting the historical hash field', () => {
    const fixture = builtPreviewFixture();
    const contextHash = fixture.hashes.contextHashes[0]!;
    const withoutDescriptorHash = { ...contextHash } as Record<string, unknown>;
    delete withoutDescriptorHash.descriptorHash;

    const missingDescriptor = playgroundBuiltPreviewSchema.safeParse({
      ...fixture,
      hashes: { ...fixture.hashes, contextHashes: [withoutDescriptorHash] },
    });
    expect(missingDescriptor.success).toBe(false);
    if (!missingDescriptor.success) {
      expect(missingDescriptor.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_type',
            path: ['hashes', 'contextHashes', 0, 'descriptorHash'],
          }),
        ]),
      );
    }

    const legacyHash = playgroundBuiltPreviewSchema.safeParse({
      ...fixture,
      hashes: {
        ...fixture.hashes,
        contextHashes: [{ ...contextHash, hash: contextHash.descriptorHash }],
      },
    });
    expect(legacyHash.success).toBe(false);
    if (!legacyHash.success) {
      expect(legacyHash.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'unrecognized_keys',
            path: ['hashes', 'contextHashes', 0],
            keys: ['hash'],
          }),
        ]),
      );
    }
  });

  it('accepts real previews produced by every Prompt Inspector adapter', async () => {
    const inspector = await createPlaygroundRuntime({
      environment: { NODE_ENV: 'test' },
      knowledgeRoot: KNOWLEDGE_ROOT,
    });

    for (const descriptor of inspector.catalog().agents) {
      const preview = await inspector.preview({
        agent: descriptor.agent,
        input: descriptor.examples[0]!.input,
      });

      expect(preview.status).toBe('BUILT');
      if (preview.status !== 'BUILT') throw new TypeError('Expected a built inspection preview.');

      expect(preview.hashes.contextHashes.length).toBeGreaterThan(0);
      expect(promptInspectionBuiltPreviewSchema.safeParse(preview).success).toBe(true);
      expect(playgroundBuiltPreviewSchema.safeParse(preview).success).toBe(true);
      expect(playgroundPreviewSchema.safeParse(preview).success).toBe(true);
    }
  });
});
