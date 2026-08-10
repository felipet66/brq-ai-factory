import { mkdir, realpath } from 'node:fs/promises';

import {
  WORKSPACE_MANIFEST,
  WORKSPACE_ROOT,
  assertCondition,
  parseWorkspaceArguments,
  readStdin,
  reportSuccess,
  runHelper,
  validateEnvelope,
  validateIntegrationPackage,
  verifyPreparedWorkspace,
  writeJsonFile,
  writeVerifiedFile,
} from './common.mjs';

await runHelper('PREPARE', async () => {
  parseWorkspaceArguments(process.argv.slice(2));
  const input = await readStdin(640 * 1024);
  const envelope = validateEnvelope(JSON.parse(input));
  const packageFile = envelope.files.find((file) => file.path === 'package.json');
  assertCondition(packageFile !== undefined, 'PACKAGE_REQUIRED');
  validateIntegrationPackage(packageFile.content);

  await mkdir(WORKSPACE_ROOT, { recursive: true, mode: 0o700 });
  assertCondition((await realpath(WORKSPACE_ROOT)) === WORKSPACE_ROOT, 'WORKSPACE_ALIAS');
  for (const file of envelope.files) {
    await writeVerifiedFile(WORKSPACE_ROOT, file.path, file.content);
  }
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
  await verifyPreparedWorkspace();
  reportSuccess(`BRQ_PREPARE_OK files=${envelope.files.length} bytes=${envelope.totalBytes}`);
});
