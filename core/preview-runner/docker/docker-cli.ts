import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface DockerCommandRequest {
  readonly args: readonly string[];
  readonly input?: Buffer;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
  readonly signal?: AbortSignal;
}

export interface DockerCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly outputLimitExceeded: boolean;
  readonly sourceCode: string | null;
}

export interface DockerCommandExecutor {
  execute(request: DockerCommandRequest): Promise<DockerCommandResult>;
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

function sourceCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) return null;
  const candidate = (error as { readonly code?: unknown }).code;
  return typeof candidate === 'string' && SAFE_SOURCE_CODES.has(candidate) ? candidate : null;
}

function terminate(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

function decode(chunks: readonly Buffer[]): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

export function createNodeDockerCommandExecutor(options: {
  readonly executable: string;
  readonly dockerHost: string;
}): DockerCommandExecutor {
  return Object.freeze({
    execute: async (request: DockerCommandRequest) =>
      new Promise<DockerCommandResult>((resolve) => {
        const child = spawn(options.executable, [...request.args], {
          shell: false,
          env: Object.freeze({
            DOCKER_HOST: options.dockerHost,
            LANG: 'C',
            LC_ALL: 'C',
            NODE_ENV: 'production',
          }),
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let observedBytes = 0;
        let timedOut = false;
        let cancelled = false;
        let outputLimitExceeded = false;
        let observedSourceCode: string | null = null;
        let settled = false;

        const observe = (target: Buffer[], chunk: Buffer) => {
          observedBytes += chunk.byteLength;
          if (observedBytes <= request.outputLimitBytes) target.push(chunk);
          else if (!outputLimitExceeded) {
            outputLimitExceeded = true;
            terminate(child);
          }
        };
        child.stdout.on('data', (chunk: Buffer) => observe(stdout, chunk));
        child.stderr.on('data', (chunk: Buffer) => observe(stderr, chunk));
        child.stdin.on('error', () => {
          // EPIPE is represented by the process outcome and does not escape this boundary.
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
          observedSourceCode = sourceCode(error);
        });
        child.once('close', (exitCode) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          request.signal?.removeEventListener('abort', onAbort);
          let stdoutValue = '';
          let stderrValue = '';
          try {
            stdoutValue = decode(stdout);
            stderrValue = decode(stderr);
          } catch {
            observedSourceCode = 'INVALID_UTF8';
          }
          resolve(
            Object.freeze({
              exitCode,
              stdout: stdoutValue,
              stderr: stderrValue,
              timedOut,
              cancelled,
              outputLimitExceeded,
              sourceCode: observedSourceCode,
            }),
          );
        });
        if (request.input === undefined) child.stdin.end();
        else child.stdin.end(request.input);
      }),
  });
}
