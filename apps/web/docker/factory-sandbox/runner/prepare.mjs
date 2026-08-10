import { mkdir, realpath } from 'node:fs/promises';

import {
  WORKSPACE_MANIFEST,
  WORKSPACE_ROOT,
  parseWorkspaceArguments,
  readStdin,
  reportSuccess,
  runHelper,
  sourcePathsFromManifest,
  validateEnvelope,
  validateOptionalPackage,
  verifyPreparedWorkspace,
  writeJsonFile,
  writeVerifiedFile,
} from './common.mjs';

await runHelper('PREPARE', async () => {
  parseWorkspaceArguments(process.argv.slice(2));
  const input = await readStdin(640 * 1024);
  const envelope = validateEnvelope(JSON.parse(input));
  const packageFile = envelope.files.find((file) => file.path === 'package.json');
  if (packageFile !== undefined) validateOptionalPackage(packageFile.content);

  await mkdir(WORKSPACE_ROOT, { recursive: true, mode: 0o700 });
  if ((await realpath(WORKSPACE_ROOT)) !== WORKSPACE_ROOT) throw new Error('WORKSPACE_ALIAS');
  for (const file of envelope.files)
    await writeVerifiedFile(WORKSPACE_ROOT, file.path, file.content);
  await writeJsonFile(WORKSPACE_MANIFEST, {
    abi: 'brq.sandbox.workspace.manifest.v1',
    workspaceId: envelope.workspaceId,
    workspaceHash: envelope.workspaceHash,
    totalBytes: envelope.totalBytes,
    files: envelope.files.map(({ path, byteLength, contentHash }) => ({
      path,
      byteLength,
      contentHash,
    })),
  });
  const manifest = await verifyPreparedWorkspace();
  sourcePathsFromManifest(manifest);
  reportSuccess(`BRQ_PREPARE_OK files=${envelope.files.length} bytes=${envelope.totalBytes}`);
});
