import type { RateLimiter } from './handler';

export type { RateLimiter };

export interface TokenBucketOptions {
  /** Maximum tokens the bucket holds (== max burst size). */
  readonly capacity: number;
  /** Tokens added per millisecond; capped at capacity. */
  readonly refillTokensPerMs: number;
  /** Time source; defaults to `Date.now`. Injected for deterministic tests. */
  readonly now?: () => number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

/**
 * In-process token-bucket rate limiter keyed by an arbitrary string (in
 * production: client IP). Allocates one bucket per first-seen key; buckets are
 * retained for the process lifetime. EA-stage traffic is small enough that the
 * map's memory footprint is bounded by the population of legitimate clients.
 */
export function createTokenBucketRateLimiter(options: TokenBucketOptions): RateLimiter {
  const { capacity, refillTokensPerMs } = options;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  return {
    allow(key: string): boolean {
      const nowMs = now();
      const existing = buckets.get(key);
      if (existing === undefined) {
        buckets.set(key, { tokens: capacity - 1, lastRefillMs: nowMs });
        return true;
      }
      const elapsedMs = Math.max(0, nowMs - existing.lastRefillMs);
      existing.tokens = Math.min(capacity, existing.tokens + elapsedMs * refillTokensPerMs);
      existing.lastRefillMs = nowMs;
      if (existing.tokens >= 1) {
        existing.tokens -= 1;
        return true;
      }
      return false;
    },
  };
}

/**
 * Convenience factory that converts a "requests per minute per key" threshold
 * into the underlying token-bucket parameters. The bucket starts full so the
 * first N requests inside the same second go through (legitimate clients
 * behind a NAT often burst at startup); the refill rate is uniform across
 * the minute.
 */
export function createRequestsPerMinuteRateLimiter(rpm: number, now?: () => number): RateLimiter {
  return createTokenBucketRateLimiter({
    capacity: rpm,
    refillTokensPerMs: rpm / 60_000,
    ...(now ? { now } : {}),
  });
}
