import { describe, expect, it, vi } from 'vitest';

import { calculateRetryDelay, executeWithRetry } from './retry-policy';

describe('retry policy', () => {
  it('should retry retryable failures and report the number of attempts', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('connection-1'))
      .mockRejectedValueOnce(new Error('connection-2'))
      .mockResolvedValue('ok');
    const delays: number[] = [];

    const result = await executeWithRetry({
      operation,
      maxRetries: 2,
      shouldRetry: () => true,
      random: () => 0,
      sleep: async (delay) => {
        delays.push(delay);
      },
    });

    expect(result).toEqual({ value: 'ok', attempts: 3 });
    expect(delays).toEqual([125, 250]);
  });

  it('should not retry non-retryable failures', async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('http-error'));

    await expect(
      executeWithRetry({
        operation,
        maxRetries: 2,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow('http-error');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should stop after the configured retry limit', async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('connection'));

    await expect(
      executeWithRetry({
        operation,
        maxRetries: 1,
        shouldRetry: () => true,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow('connection');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('should stop before the first attempt when already cancelled', async () => {
    const controller = new AbortController();
    const operation = vi.fn<() => Promise<string>>();
    controller.abort(new Error('cancelled'));

    await expect(
      executeWithRetry({
        operation,
        maxRetries: 2,
        shouldRetry: () => true,
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled');
    expect(operation).not.toHaveBeenCalled();
  });

  it('should clamp jitter input and cap exponential delays', () => {
    expect(calculateRetryDelay(1, -1)).toBe(125);
    expect(calculateRetryDelay(20, 2)).toBe(2_000);
  });
});
