import { readFile } from 'node:fs/promises';

import {
  ARTIFACT_ABI_VERSION,
  ARTIFACT_EXPORTER_VERSION,
  BUILD_ROOT,
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACT_FILES,
  PROFILE_ID,
  REQUIRED_ENTRYPOINT,
  REQUIRED_ENTRYPOINT_REASON,
  assertCondition,
  containedPath,
  parseWorkspaceArguments,
  runHelper,
  verifyBuildOutput,
  verifyPreparedWorkspace,
} from './common.mjs';

await runHelper('EXPORT', async () => {
  parseWorkspaceArguments(process.argv.slice(2));
  await verifyPreparedWorkspace();
  const manifest = await verifyBuildOutput();
  const files = [];
  let totalBytes = 0;
  for (const entry of manifest.files.filter((file) => file.visibility === 'PREVIEW')) {
    const content = await readFile(containedPath(BUILD_ROOT, entry.path));
    totalBytes += content.byteLength;
    files.push({
      path: entry.path,
      mediaType: entry.mediaType,
      encoding: 'BASE64',
      byteLength: entry.byteLength,
      contentHash: entry.contentHash,
      content: content.toString('base64'),
    });
  }
  assertCondition(files.length > 0 && files.length <= MAX_ARTIFACT_FILES, 'ARTIFACT_FILES');
  assertCondition(
    files.some((file) => file.path === REQUIRED_ENTRYPOINT),
    REQUIRED_ENTRYPOINT_REASON,
  );
  assertCondition(totalBytes > 0 && totalBytes <= MAX_ARTIFACT_BYTES, 'ARTIFACT_BYTES');
  process.stdout.write(
    `${JSON.stringify({
      abiVersion: ARTIFACT_ABI_VERSION,
      profileId: PROFILE_ID,
      exporterVersion: ARTIFACT_EXPORTER_VERSION,
      files: files.map(({ path, mediaType, content }) => ({
        path,
        content: Buffer.from(content, 'base64').toString('utf8'),
        mediaType,
      })),
    })}\n`,
  );
});
