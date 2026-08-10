import { spawn } from 'node:child_process';

import {
  BUILD_ROOT,
  containedPath,
  parseWorkspaceArguments,
  reportSuccess,
  runHelper,
  verifyBuildOutput,
  verifyPreparedWorkspace,
} from './common.mjs';

await runHelper('TEST', async () => {
  parseWorkspaceArguments(process.argv.slice(2));
  await verifyPreparedWorkspace();
  const buildManifest = await verifyBuildOutput();
  const tests = buildManifest.files
    .filter(
      (file) =>
        file.visibility === 'TEST' && /(?:^|\/)(?:tests?\/.*|.*\.test)\.js$/u.test(file.path),
    )
    .map((file) => file.path);
  if (tests.length === 0) throw new Error('NO_TEST_FILES');
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      '/usr/local/bin/node',
      [
        '--test',
        '--test-concurrency=1',
        ...tests.map((testPath) => containedPath(BUILD_ROOT, testPath)),
      ],
      {
        cwd: BUILD_ROOT,
        env: { CI: '1', NO_COLOR: '1', PATH: '/usr/local/bin:/usr/bin:/bin' },
        stdio: 'inherit',
        shell: false,
      },
    );
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (exitCode !== 0) throw new Error('TEST_FAILED');
  reportSuccess(`BRQ_TEST_OK files=${tests.length}`);
});
