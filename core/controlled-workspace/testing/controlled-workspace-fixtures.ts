import type { WorkspacePlanRequest } from '../contracts';
import { calculateWorkspaceBundleContentHash, calculateWorkspaceContentHash } from '../hashing';

const hash = (character: string): string => character.repeat(64);

export function createWorkspacePlanRequestFixture(
  overrides: Partial<WorkspacePlanRequest> = {},
): WorkspacePlanRequest {
  const files: WorkspacePlanRequest['files'] = [
    {
      path: 'src/index.ts',
      content: 'export const ready = true;\n',
      encoding: 'UTF-8',
      mediaType: 'text/typescript',
      purpose: 'SOURCE',
      byteLength: Buffer.byteLength('export const ready = true;\n', 'utf8'),
      contentHash: calculateWorkspaceContentHash('export const ready = true;\n'),
    },
    {
      path: 'package.json',
      content: '{"name":"generated-app","private":true}\n',
      encoding: 'UTF-8',
      mediaType: 'application/json',
      purpose: 'CONFIGURATION',
      byteLength: Buffer.byteLength('{"name":"generated-app","private":true}\n', 'utf8'),
      contentHash: calculateWorkspaceContentHash('{"name":"generated-app","private":true}\n'),
    },
  ];
  const requestedFiles = overrides.files ?? files;
  return {
    source: {
      technicalSpecificationHash: `sha256:${hash('a')}`,
      generationHash: hash('b'),
      bundleHash: hash('c'),
      bundleContentHash: calculateWorkspaceBundleContentHash(requestedFiles),
      bundleVersion: '1.0.0',
      contractVersion: '1.0.0',
      ...overrides.source,
    },
    files: requestedFiles,
  };
}
