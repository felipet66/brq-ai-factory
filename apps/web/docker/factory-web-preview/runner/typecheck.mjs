import {
  assertNoDiagnostics,
  compilerOptions,
  compilerRootNames,
  loadTypeScript,
  parseWorkspaceArguments,
  reportSuccess,
  runHelper,
  verifyPreparedWorkspace,
} from './common.mjs';

await runHelper('TYPECHECK', async () => {
  parseWorkspaceArguments(process.argv.slice(2));
  const manifest = await verifyPreparedWorkspace();
  const typescript = loadTypeScript();
  const roots = await compilerRootNames(manifest);
  const program = typescript.createProgram(roots, compilerOptions(typescript, { noEmit: true }));
  assertNoDiagnostics(typescript, program);
  reportSuccess(`BRQ_TYPECHECK_OK files=${roots.length - 1}`);
});
