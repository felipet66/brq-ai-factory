import { mkdir, realpath, writeFile } from 'node:fs/promises';

import {
  ARTIFACT_MANIFEST,
  PROFILE_ID,
  SITE_ROOT,
  assertCondition,
  readStdin,
  runHelper,
  validateArtifactEnvelope,
  verifyPreparedSite,
  writeVerifiedFile,
} from './common.mjs';

await runHelper('PREPARE', async () => {
  assertCondition(process.argv.length === 2, 'INVALID_ARGUMENTS');
  const envelope = validateArtifactEnvelope(JSON.parse(await readStdin()));
  await mkdir(SITE_ROOT, { recursive: true, mode: 0o700 });
  assertCondition((await realpath(SITE_ROOT)) === SITE_ROOT, 'SITE_ALIAS');
  for (const file of envelope.files) await writeVerifiedFile(file.path, file.content);
  await writeFile(
    ARTIFACT_MANIFEST,
    `${JSON.stringify({
      abi: 'brq.preview.runtime.manifest.v1',
      profileId: PROFILE_ID,
      exporterVersion: envelope.exporterVersion,
      artifactContentHash: envelope.artifactContentHash,
      totalBytes: envelope.totalBytes,
      files: envelope.files.map(({ path, mediaType, byteLength, contentHash }) => ({
        path,
        mediaType,
        byteLength,
        contentHash,
      })),
    })}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  await verifyPreparedSite();
  process.stdout.write(
    `BRQ_PREVIEW_PREPARE_OK files=${envelope.files.length} bytes=${envelope.totalBytes}\n`,
  );
});
