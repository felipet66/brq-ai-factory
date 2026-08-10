import {
  assertNoDiagnostics,
  compilerOptions,
  loadTypeScript,
  parseWorkspaceArguments,
  reportSuccess,
  runHelper,
  sourceFilesFromManifest,
  verifyPreparedWorkspace,
} from './common.mjs';

await runHelper('TYPECHECK', async () => {
  parseWorkspaceArguments(process.argv.slice(2));
  const manifest = await verifyPreparedWorkspace();
  const typescript = loadTypeScript();
  const sourceFiles = sourceFilesFromManifest(manifest);
  const program = typescript.createProgram(
    sourceFiles,
    compilerOptions(typescript, { noEmit: true }),
  );
  assertNoDiagnostics(typescript, program);
  reportSuccess(`BRQ_TYPECHECK_OK files=${sourceFiles.length}`);
});
