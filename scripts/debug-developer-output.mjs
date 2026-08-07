import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW_DEBUG_FLAG = 'AI_FACTORY_STRUCTURED_OUTPUT_RAW_DEBUG';
const INPUT_ENVIRONMENT_VARIABLE = 'AI_FACTORY_DEVELOPER_OUTPUT_FILE';
const REPORT_ENVIRONMENT_VARIABLE = 'AI_FACTORY_DEVELOPER_OUTPUT_REPORT_FILE';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowedDirectory = path.join(repositoryRoot, '.ai', 'debug', 'structured-output');
const inputArgument = process.argv[2];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

if (process.env[RAW_DEBUG_FLAG] !== 'true') {
  fail(`${RAW_DEBUG_FLAG}=true é obrigatório para ler um payload local.`);
} else if (inputArgument === undefined || inputArgument.trim().length === 0) {
  fail('Informe um arquivo JSON dentro de .ai/debug/structured-output/.');
} else {
  const inputPath = path.resolve(repositoryRoot, inputArgument);
  let temporaryDirectory;

  try {
    const realAllowedDirectory = realpathSync(allowedDirectory);
    const realInputPath = realpathSync(inputPath);
    const relativePath = path.relative(realAllowedDirectory, realInputPath);
    const isInsideAllowedDirectory =
      relativePath.length > 0 &&
      !relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath);

    if (!isInsideAllowedDirectory || path.extname(realInputPath).toLowerCase() !== '.json') {
      fail('O arquivo deve ser um JSON dentro de .ai/debug/structured-output/.');
    } else if (!statSync(realInputPath).isFile()) {
      fail('O caminho informado não é um arquivo regular.');
    } else {
      temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'brq-ai-factory-developer-output-'));
      const reportPath = path.join(temporaryDirectory, 'report.json');
      const vitestEntrypoint = path.join(repositoryRoot, 'node_modules', 'vitest', 'vitest.mjs');
      const result = spawnSync(
        process.execPath,
        [
          vitestEntrypoint,
          'run',
          'agents/developer/developer-output-harness.spec.ts',
          '--reporter=verbose',
        ],
        {
          cwd: repositoryRoot,
          env: {
            ...process.env,
            NODE_ENV: 'development',
            AI_FACTORY_STRUCTURED_OUTPUT_DEBUG: 'true',
            [INPUT_ENVIRONMENT_VARIABLE]: realInputPath,
            [REPORT_ENVIRONMENT_VARIABLE]: reportPath,
          },
          stdio: 'ignore',
          shell: false,
        },
      );

      if (result.error !== undefined || result.status !== 0) {
        fail('Não foi possível iniciar o harness local do Developer.');
      } else {
        const report = JSON.parse(readFileSync(reportPath, 'utf8'));
        process.stdout.write(`${JSON.stringify(report)}\n`);
      }
    }
  } catch {
    fail(
      'Não foi possível abrir o arquivo. Crie-o dentro de .ai/debug/structured-output/ e tente novamente.',
    );
  } finally {
    if (temporaryDirectory !== undefined) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}
