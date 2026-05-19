import { describe, expect, it } from 'vitest';
import {
  createRequestsPerMinuteRateLimiter,
  createTokenBucketRateLimiter,
} from '../src/rate-limiter';

describe('createTokenBucketRateLimiter', () => {
  it('grants the configured capacity worth of requests before throttling', () => {
    const limiter = createTokenBucketRateLimiter({
      capacity: 3,
      refillTokensPerMs: 0,
      now: () => 0,
    });

    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(false);
  });

  it('isolates buckets by key so one key burst does not block another', () => {
    const limiter = createTokenBucketRateLimiter({
      capacity: 2,
      refillTokensPerMs: 0,
      now: () => 0,
    });

    expect(limiter.allow('alice')).toBe(true);
    expect(limiter.allow('alice')).toBe(true);
    expect(limiter.allow('alice')).toBe(false);

    expect(limiter.allow('bob')).toBe(true);
    expect(limiter.allow('bob')).toBe(true);
    expect(limiter.allow('bob')).toBe(false);
  });

  it('refills tokens over time at the configured rate', () => {
    let now = 0;
    const limiter = createTokenBucketRateLimiter({
      capacity: 2,
      refillTokensPerMs: 1 / 1000,
      now: () => now,
    });

    expect(limiter.allow('key')).toBe(true);
    expect(limiter.allow('key')).toBe(true);
    expect(limiter.allow('key')).toBe(false);

    now = 999;
    expect(limiter.allow('key')).toBe(false);
    now = 1000;
    expect(limiter.allow('key')).toBe(true);
  });

  it('caps refilled tokens at capacity (no carry-over beyond the burst budget)', () => {
    let now = 0;
    const limiter = createTokenBucketRateLimiter({
      capacity: 2,
      refillTokensPerMs: 1 / 1000,
      now: () => now,
    });
    expect(limiter.allow('key')).toBe(true);

    now = 60_000;
    expect(limiter.allow('key')).toBe(true);
    expect(limiter.allow('key')).toBe(true);
    expect(limiter.allow('key')).toBe(false);
  });
});

describe('createRequestsPerMinuteRateLimiter', () => {
  it('caps a same-instant burst at the requests-per-minute threshold', () => {
    const limiter = createRequestsPerMinuteRateLimiter(60, () => 0);
    for (let i = 0; i < 60; i += 1) {
      expect(limiter.allow('client')).toBe(true);
    }
    expect(limiter.allow('client')).toBe(false);
  });

  it('lets through one additional request per token-refill interval', () => {
    let now = 0;
    const limiter = createRequestsPerMinuteRateLimiter(60, () => now);
    for (let i = 0; i < 60; i += 1) {
      limiter.allow('client');
    }
    expect(limiter.allow('client')).toBe(false);
    now = 1000;
    expect(limiter.allow('client')).toBe(true);
    expect(limiter.allow('client')).toBe(false);
  });
});
