import { spawn } from 'node:child_process';

import {
  BUILD_ROOT,
  containedPath,
  parseWorkspaceArguments,
  reportSuccess,
  runHelper,
  sourcePathsFromManifest,
  testPathsFromSources,
  verifyBuildOutput,
  verifyPreparedWorkspace,
} from './common.mjs';

function builtTestPath(sourcePath) {
  return sourcePath.endsWith('.ts') ? `${sourcePath.slice(0, -3)}.js` : sourcePath;
}

await runHelper('TEST', async () => {
  parseWorkspaceArguments(process.argv.slice(2));
  const workspaceManifest = await verifyPreparedWorkspace();
  const buildManifest = await verifyBuildOutput();
  const tests = testPathsFromSources(sourcePathsFromManifest(workspaceManifest)).map(builtTestPath);
  const builtPaths = new Set(buildManifest.files.map((file) => file.path));
  if (!tests.every((testPath) => builtPaths.has(testPath))) throw new Error('TEST_BUILD_MISSING');
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
