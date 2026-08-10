import { lstat, mkdir, realpath } from 'node:fs/promises';

import { WORKSPACE_ROOT, assertCondition, runHelper } from './common.mjs';

await runHelper('READY', async () => {
  assertCondition(process.argv.length === 2, 'INVALID_ARGUMENTS');
  for (const directory of [WORKSPACE_ROOT, '/tmp/home']) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(directory);
    assertCondition(metadata.isDirectory() && !metadata.isSymbolicLink(), 'READY_DIRECTORY');
    assertCondition((await realpath(directory)) === directory, 'READY_DIRECTORY');
  }
});
