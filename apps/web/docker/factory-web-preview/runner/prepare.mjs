import { mkdir, realpath } from 'node:fs/promises';

import {
  WORKSPACE_MANIFEST,
  WORKSPACE_ROOT,
  assertCondition,
  parseWorkspaceArguments,
  readStdin,
  reportSuccess,
  runHelper,
  validateExecutionProfileFiles,
  validateWorkspaceEnvelope,
  verifyPreparedWorkspace,
  writeJsonFile,
  writeVerifiedFile,
} from './common.mjs';

await runHelper('PREPARE', async () => {
  parseWorkspaceArguments(process.argv.slice(2));
  const input = await readStdin(640 * 1024);
  const envelope = validateWorkspaceEnvelope(JSON.parse(input));
  validateExecutionProfileFiles(envelope.files);

  await mkdir(WORKSPACE_ROOT, { recursive: true, mode: 0o700 });
  assertCondition((await realpath(WORKSPACE_ROOT)) === WORKSPACE_ROOT, 'WORKSPACE_ALIAS');
  for (const file of envelope.files)
    await writeVerifiedFile(WORKSPACE_ROOT, file.path, file.content);
  await writeJsonFile(WORKSPACE_MANIFEST, {
    abi: 'brq.sandbox.web-workspace.manifest.v1',
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
