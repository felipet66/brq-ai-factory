import { createRequire } from 'node:module';

import {
  BUILD_ROOT,
  assertCondition,
  containedPath,
  parseWorkspaceArguments,
  reportSuccess,
  runHelper,
  verifyBuildOutput,
  verifyPreparedWorkspace,
} from './common.mjs';

const require = createRequire(import.meta.url);

await runHelper('TEST', async () => {
  parseWorkspaceArguments(process.argv.slice(2));
  await verifyPreparedWorkspace();
  const buildManifest = await verifyBuildOutput();
  const entry = buildManifest.files.find((file) => file.path === 'src/index.js');
  assertCondition(entry !== undefined, 'TEST_ENTRY');
  const generatedModule = require(containedPath(BUILD_ROOT, entry.path));
  assertCondition(generatedModule.ready === true, 'TEST_ASSERTION');
  reportSuccess('BRQ_TEST_OK ready=true');
});
