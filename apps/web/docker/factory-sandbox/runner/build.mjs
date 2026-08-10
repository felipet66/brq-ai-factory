import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  BUILD_MANIFEST,
  BUILD_ROOT,
  WORKSPACE_ROOT,
  assertCondition,
  assertNoDiagnostics,
  compilerOptions,
  compilerRootNames,
  inspectSafePath,
  loadTypeScript,
  parseWorkspaceArguments,
  reportSuccess,
  runHelper,
  sha256,
  verifyBuildOutput,
  verifyPreparedWorkspace,
  writeJsonFile,
  writeVerifiedFile,
} from './common.mjs';

await runHelper('BUILD', async () => {
  parseWorkspaceArguments(process.argv.slice(2));
  const manifest = await verifyPreparedWorkspace();
  const typescript = loadTypeScript();
  const roots = await compilerRootNames(manifest);
  const program = typescript.createProgram(
    roots,
    compilerOptions(typescript, { rootDir: WORKSPACE_ROOT, outDir: BUILD_ROOT }),
  );
  assertNoDiagnostics(typescript, program);
  const outputs = [];
  const emit = program.emit(undefined, (fileName, data) => {
    if (fileName === BUILD_MANIFEST) return;
    const relativePath = path.relative(BUILD_ROOT, fileName).split(path.sep).join('/');
    inspectSafePath(relativePath);
    assertCondition(!relativePath.startsWith('../'), 'BUILD_PATH');
    outputs.push({ path: relativePath, content: Buffer.from(data, 'utf8') });
  });
  assertCondition(!emit.emitSkipped && outputs.length > 0, 'BUILD_EMIT');
  await rm(BUILD_ROOT, { recursive: true, force: true });
  await mkdir(BUILD_ROOT, { recursive: true, mode: 0o700 });
  for (const output of outputs) await writeVerifiedFile(BUILD_ROOT, output.path, output.content);
  await writeJsonFile(BUILD_MANIFEST, {
    abi: 'brq.sandbox.build.manifest.v1',
    files: outputs.map(({ path: outputPath, content }) => ({
      path: outputPath,
      byteLength: content.byteLength,
      contentHash: sha256(content),
    })),
  });
  await verifyBuildOutput();
  reportSuccess(`BRQ_BUILD_OK files=${outputs.length}`);
});
