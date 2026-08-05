export const RETRY_BASE_DELAY_MS = 250;
export const RETRY_MAX_DELAY_MS = 2_000;

export interface RetryNotification {
  failedAttempt: number;
  nextAttempt: number;
  delayMs: number;
  error: unknown;
}

export interface ExecuteWithRetryOptions<T> {
  operation: (attempt: number) => Promise<T>;
  maxRetries: number;
  shouldRetry: (error: unknown) => boolean;
  signal?: AbortSignal;
  onRetry?: (notification: RetryNotification) => void;
  random?: () => number;
  sleep?: (durationMs: number, signal?: AbortSignal) => Promise<void>;
}

export interface RetryResult<T> {
  value: T;
  attempts: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
  }
}

export function calculateRetryDelay(failedAttempt: number, randomValue: number): number {
  const exponentialDelay = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** (failedAttempt - 1),
    RETRY_MAX_DELAY_MS,
  );
  const jitterMultiplier = 0.5 + Math.min(Math.max(randomValue, 0), 1) * 0.5;

  return Math.round(exponentialDelay * jitterMultiplier);
}

export function abortableSleep(durationMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, durationMs);

    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function executeWithRetry<T>(
  options: ExecuteWithRetryOptions<T>,
): Promise<RetryResult<T>> {
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? abortableSleep;
  let attempt = 0;

  while (true) {
    throwIfAborted(options.signal);
    attempt += 1;

    try {
      return { value: await options.operation(attempt), attempts: attempt };
    } catch (error) {
      const retriesUsed = attempt - 1;

      if (
        retriesUsed >= options.maxRetries ||
        !options.shouldRetry(error) ||
        options.signal?.aborted
      ) {
        throw error;
      }

      const delayMs = calculateRetryDelay(attempt, random());
      options.onRetry?.({
        failedAttempt: attempt,
        nextAttempt: attempt + 1,
        delayMs,
        error,
      });
      await sleep(delayMs, options.signal);
    }
  }
}
