import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, spawn: spawnMock };
});

import { createNodeDockerCommandExecutor, type DockerCommandRequest } from './docker-cli';

class FakeChildProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn((signal: NodeJS.Signals) => {
    this.signalCode = signal;
    return true;
  });

  close(exitCode: number | null): void {
    this.exitCode = exitCode;
    this.emit('close', exitCode, this.signalCode);
  }

  fail(error: unknown): void {
    this.emit('error', error);
  }
}

const baseRequest: DockerCommandRequest = {
  args: ['version', '--format', '{{json .}}'],
  timeoutMs: 1_000,
  hardOutputBytes: 4_096,
  capturedOutputBytesPerStream: 1_024,
};

function executor() {
  return createNodeDockerCommandExecutor({
    executable: '/usr/local/bin/docker',
    dockerHost: 'unix:///var/run/docker.sock',
  });
}

function nextChild(): FakeChildProcess {
  const child = new FakeChildProcess();
  spawnMock.mockReturnValueOnce(child);
  return child;
}

afterEach(() => {
  vi.useRealTimers();
  spawnMock.mockReset();
});

describe('Node Docker command executor', () => {
  it('spawns without a shell and with a closed, deterministic environment', async () => {
    const child = nextChild();
    const execution = executor().execute(baseRequest);

    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/local/bin/docker',
      ['version', '--format', '{{json .}}'],
      {
        shell: false,
        env: {
          DOCKER_HOST: 'unix:///var/run/docker.sock',
          LANG: 'C',
          LC_ALL: 'C',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    expect(spawnMock.mock.calls[0]?.[2]?.env).not.toHaveProperty('PATH');
    expect(spawnMock.mock.calls[0]?.[2]?.env).not.toHaveProperty('HOME');

    child.close(0);
    await expect(execution).resolves.toMatchObject({ exitCode: 0, sourceCode: null });
  });

  it('writes the optional payload only to stdin and captures output metrics', async () => {
    const child = nextChild();
    const inputChunks: Buffer[] = [];
    child.stdin.on('data', (chunk: Buffer) => inputChunks.push(chunk));
    const input = Buffer.from('{"workspace":"payload"}', 'utf8');
    const execution = executor().execute({ ...baseRequest, input });

    child.stdout.write('first\nsecond');
    child.stderr.write('warning\n');
    child.close(0);
    const result = await execution;

    expect(Buffer.concat(inputChunks)).toEqual(input);
    expect(result.stdout).toEqual({
      value: 'first\nsecond',
      observedBytes: 12,
      observedLines: 2,
      captureTruncated: false,
    });
    expect(result.stderr).toEqual({
      value: 'warning\n',
      observedBytes: 8,
      observedLines: 2,
      captureTruncated: false,
    });
    expect(result).toMatchObject({
      timedOut: false,
      cancelled: false,
      outputLimitExceeded: false,
    });
  });

  it('kills the child once combined output exceeds the hard limit', async () => {
    const child = nextChild();
    const execution = executor().execute({
      ...baseRequest,
      hardOutputBytes: 5,
      capturedOutputBytesPerStream: 4,
    });

    child.stdout.write('123');
    child.stderr.write('456');
    expect(child.kill).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.close(null);

    await expect(execution).resolves.toMatchObject({
      outputLimitExceeded: true,
      timedOut: false,
      cancelled: false,
    });
  });

  it('kills and reports a command that exceeds its timeout', async () => {
    vi.useFakeTimers();
    const child = nextChild();
    const execution = executor().execute({ ...baseRequest, timeoutMs: 25 });

    await vi.advanceTimersByTimeAsync(25);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.close(null);

    await expect(execution).resolves.toMatchObject({ timedOut: true, cancelled: false });
  });

  it('propagates AbortSignal as cancellation and removes the listener on close', async () => {
    const child = nextChild();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const execution = executor().execute({ ...baseRequest, signal: controller.signal });

    controller.abort();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.close(null);
    await expect(execution).resolves.toMatchObject({ cancelled: true, timedOut: false });
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('allows only stable process error codes across the boundary', async () => {
    const allowedChild = nextChild();
    const allowedExecution = executor().execute(baseRequest);
    allowedChild.fail({ code: 'ENOENT', path: '/private/host/path' });
    allowedChild.close(null);
    await expect(allowedExecution).resolves.toMatchObject({ sourceCode: 'ENOENT' });

    const rejectedChild = nextChild();
    const rejectedExecution = executor().execute(baseRequest);
    rejectedChild.fail({ code: 'ESECRET:/private/host/path' });
    rejectedChild.close(null);
    await expect(rejectedExecution).resolves.toMatchObject({ sourceCode: null });
  });
});
