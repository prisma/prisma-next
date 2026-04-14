const MAX_DELAY_MS = 5 * 60 * 1000;

export interface RetryPolicy {
  readonly retries: number;
  readonly backoff: 'fixed' | 'exponential';
  readonly baseDelayMs: number;
}

export interface RetryDecision {
  readonly shouldRetry: boolean;
  readonly delayMs: number;
}

export function evalRetryPolicy(policy: RetryPolicy, attempt: number): RetryDecision {
  if (attempt > policy.retries) {
    return { shouldRetry: false, delayMs: 0 };
  }
  const delayMs =
    policy.backoff === 'exponential'
      ? Math.min(policy.baseDelayMs * 2 ** (attempt - 1), MAX_DELAY_MS)
      : policy.baseDelayMs;
  return { shouldRetry: true, delayMs };
}

export function isTimedOut(startedAt: Date, timeoutMs: number, now: Date): boolean {
  return now.getTime() - startedAt.getTime() >= timeoutMs;
}
