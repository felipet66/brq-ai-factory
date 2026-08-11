import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  BUILD_MANIFEST,
  BUILD_ROOT,
  PROFILE_ID,
  REQUIRED_ENTRYPOINT,
  REQUIRED_ENTRYPOINT_REASON,
  WORKSPACE_ROOT,
  assertCondition,
  assertNoDiagnostics,
  compilerOptions,
  compilerRootNames,
  inspectSafePath,
  isTestPath,
  loadTypeScript,
  mediaTypeFor,
  parseWorkspaceArguments,
  reportSuccess,
  runHelper,
  sha256,
  staticPathsFromManifest,
  validatePreviewSource,
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
    const relativePath = path.relative(BUILD_ROOT, fileName).split(path.sep).join('/');
    inspectSafePath(relativePath);
    assertCondition(!relativePath.startsWith('../'), 'BUILD_PATH');
    const content = Buffer.from(data, 'utf8');
    if (!isTestPath(relativePath)) validatePreviewSource(relativePath, content);
    outputs.push({
      path: relativePath,
      mediaType: 'text/javascript',
      visibility: isTestPath(relativePath) ? 'TEST' : 'PREVIEW',
      content,
    });
  });
  assertCondition(!emit.emitSkipped && outputs.length > 0, 'BUILD_EMIT');
  for (const staticPath of staticPathsFromManifest(manifest)) {
    const content = await readFile(path.join(WORKSPACE_ROOT, ...staticPath.split('/')));
    validatePreviewSource(staticPath, content);
    outputs.push({
      path: staticPath,
      mediaType: mediaTypeFor(staticPath),
      visibility: 'PREVIEW',
      content,
    });
  }
  assertCondition(
    outputs.some((output) => output.path === REQUIRED_ENTRYPOINT),
    REQUIRED_ENTRYPOINT_REASON,
  );
  const buildPackage = Buffer.from('{"private":true,"type":"module"}\n', 'utf8');
  outputs.push({
    path: 'package.json',
    mediaType: 'application/json',
    visibility: 'TEST',
    content: buildPackage,
  });
  outputs.sort((left, right) => left.path.localeCompare(right.path));
  assertCondition(
    new Set(outputs.map((output) => output.path)).size === outputs.length,
    'BUILD_PATH_COLLISION',
  );
  await rm(BUILD_ROOT, { recursive: true, force: true });
  await mkdir(BUILD_ROOT, { recursive: true, mode: 0o700 });
  for (const output of outputs) await writeVerifiedFile(BUILD_ROOT, output.path, output.content);
  await writeJsonFile(BUILD_MANIFEST, {
    abi: 'brq.sandbox.web-build.manifest.v1',
    profileId: PROFILE_ID,
    workspaceId: manifest.workspaceId,
    workspaceHash: manifest.workspaceHash,
    files: outputs.map(({ path: outputPath, mediaType, visibility, content }) => ({
      path: outputPath,
      mediaType,
      visibility,
      byteLength: content.byteLength,
      contentHash: sha256(content),
    })),
  });
  await verifyBuildOutput();
  reportSuccess(`BRQ_BUILD_OK files=${outputs.length - 1}`);
});
