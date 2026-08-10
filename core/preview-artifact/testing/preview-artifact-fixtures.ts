import type {
  ApprovedPreviewArtifact,
  PreviewArtifactCandidate,
  PreviewArtifactSourceFileInput,
} from '../contracts';
import { approvePreviewArtifact, createPreviewArtifactCandidate } from '../artifact';

const hash = (character: string): string => character.repeat(64);

export function createPreviewArtifactFilesFixture(): readonly PreviewArtifactSourceFileInput[] {
  return [
    {
      path: 'assets/app.css',
      mediaType: 'text/css',
      content: 'body { color: #123456; }\n',
    },
    {
      path: 'assets/app.js',
      mediaType: 'text/javascript',
      content: "document.querySelector('main')?.setAttribute('data-ready', 'true');\n",
    },
    {
      path: 'index.html',
      mediaType: 'text/html',
      content:
        '<!doctype html><html><head><link rel="stylesheet" href="assets/app.css"></head><body><main>BRQ Preview</main><script src="assets/app.js"></script></body></html>\n',
    },
  ];
}

export function createPreviewArtifactCandidateFixture(): PreviewArtifactCandidate {
  return createPreviewArtifactCandidate({
    executionId: 'execution-preview-fixture-001',
    workspaceHash: hash('a'),
    sandboxRequestHash: hash('b'),
    profileId: 'NODE_WEB_PREVIEW_24_V1',
    exporterVersion: '1.0.0',
    createdAt: '2026-08-10T12:00:00.000Z',
    expiresAt: '2026-08-10T12:30:00.000Z',
    files: createPreviewArtifactFilesFixture(),
  });
}

export function createApprovedPreviewArtifactFixture(): ApprovedPreviewArtifact {
  return approvePreviewArtifact({
    candidate: createPreviewArtifactCandidateFixture(),
    factoryStatus: 'SUCCESS',
    sandboxStatus: 'SUCCESS',
    workspaceReleaseStatus: 'RELEASED',
    factoryResultHash: hash('c'),
    sandboxResultHash: hash('d'),
    sandboxRequestHash: hash('b'),
    workspaceHash: hash('a'),
    approvedAt: '2026-08-10T12:00:10.000Z',
  });
}
