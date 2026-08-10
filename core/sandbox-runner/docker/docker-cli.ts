import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { BoundedDockerOutputCollector, type DockerCapturedOutput } from './output-collector';

export interface DockerCommandRequest {
  readonly args: readonly string[];
  readonly input?: Buffer;
  readonly timeoutMs: number;
  readonly hardOutputBytes: number;
  readonly capturedOutputBytesPerStream: number;
  readonly signal?: AbortSignal;
}

export interface DockerCommandResult {
  readonly exitCode: number | null;
  readonly stdout: DockerCapturedOutput;
  readonly stderr: DockerCapturedOutput;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly outputLimitExceeded: boolean;
  readonly sourceCode: string | null;
}

export interface DockerCommandExecutor {
  execute(request: DockerCommandRequest): Promise<DockerCommandResult>;
}

export interface NodeDockerCommandExecutorOptions {
  readonly executable: string;
  readonly dockerHost: string;
}

const SAFE_SOURCE_CODES = new Set([
  'E2BIG',
  'EACCES',
  'ECONNREFUSED',
  'EIO',
  'ENOENT',
  'ENOMEM',
  'ENOSPC',
  'EPERM',
  'EPIPE',
]);

function safeSourceCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' && SAFE_SOURCE_CODES.has(code) ? code : null;
}

function terminate(process: ChildProcessWithoutNullStreams): void {
  if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL');
}

export function createNodeDockerCommandExecutor(
  options: NodeDockerCommandExecutorOptions,
): DockerCommandExecutor {
  return Object.freeze({
    execute: async (request: DockerCommandRequest) =>
      new Promise<DockerCommandResult>((resolve) => {
        const child = spawn(options.executable, [...request.args], {
          shell: false,
          env: Object.freeze({
            DOCKER_HOST: options.dockerHost,
            LANG: 'C',
            LC_ALL: 'C',
          }),
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const stdout = new BoundedDockerOutputCollector(
          request.capturedOutputBytesPerStream,
          request.hardOutputBytes,
        );
        const stderr = new BoundedDockerOutputCollector(
          request.capturedOutputBytesPerStream,
          request.hardOutputBytes,
        );
        let combinedBytes = 0;
        let timedOut = false;
        let cancelled = false;
        let outputLimitExceeded = false;
        let spawnSourceCode: string | null = null;
        let settled = false;

        const observe = (collector: BoundedDockerOutputCollector, chunk: Buffer) => {
          collector.append(chunk);
          combinedBytes += chunk.byteLength;
          if (combinedBytes > request.hardOutputBytes && !outputLimitExceeded) {
            outputLimitExceeded = true;
            terminate(child);
          }
        };
        child.stdout.on('data', (chunk: Buffer) => observe(stdout, chunk));
        child.stderr.on('data', (chunk: Buffer) => observe(stderr, chunk));
        child.stdin.on('error', () => {
          // EPIPE is represented by the child outcome and never escapes the boundary.
        });

        const timeout = setTimeout(() => {
          timedOut = true;
          terminate(child);
        }, request.timeoutMs);
        timeout.unref();

        const onAbort = () => {
          cancelled = true;
          terminate(child);
        };
        request.signal?.addEventListener('abort', onAbort, { once: true });
        if (request.signal?.aborted === true) onAbort();

        child.once('error', (error) => {
          spawnSourceCode = safeSourceCode(error);
        });
        child.once('close', (exitCode) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          request.signal?.removeEventListener('abort', onAbort);
          resolve(
            Object.freeze({
              exitCode,
              stdout: stdout.finish(),
              stderr: stderr.finish(),
              timedOut,
              cancelled,
              outputLimitExceeded,
              sourceCode: spawnSourceCode,
            }),
          );
        });

        if (request.input === undefined) child.stdin.end();
        else child.stdin.end(request.input);
      }),
  });
}
