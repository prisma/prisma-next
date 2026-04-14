import { describe, expect, it } from 'vitest';
import { evalRetryPolicy, isTimedOut } from '../src/runtime/retry';

describe('evalRetryPolicy', () => {
  describe('fixed backoff', () => {
    const policy = { retries: 3, backoff: 'fixed' as const, baseDelayMs: 1000 };

    it('allows retry on attempt 1 (first failure)', () => {
      expect(evalRetryPolicy(policy, 1).shouldRetry).toBe(true);
    });

    it('allows retry on attempt 2', () => {
      expect(evalRetryPolicy(policy, 2).shouldRetry).toBe(true);
    });

    it('allows retry on attempt 3 (last allowed)', () => {
      expect(evalRetryPolicy(policy, 3).shouldRetry).toBe(true);
    });

    it('rejects retry on attempt 4 (exhausted)', () => {
      expect(evalRetryPolicy(policy, 4).shouldRetry).toBe(false);
    });

    it('returns base delay for all attempts', () => {
      expect(evalRetryPolicy(policy, 1).delayMs).toBe(1000);
      expect(evalRetryPolicy(policy, 2).delayMs).toBe(1000);
      expect(evalRetryPolicy(policy, 3).delayMs).toBe(1000);
    });
  });

  describe('exponential backoff', () => {
    const policy = { retries: 5, backoff: 'exponential' as const, baseDelayMs: 1000 };

    it('allows retry within limit', () => {
      expect(evalRetryPolicy(policy, 1).shouldRetry).toBe(true);
      expect(evalRetryPolicy(policy, 5).shouldRetry).toBe(true);
    });

    it('rejects retry beyond limit', () => {
      expect(evalRetryPolicy(policy, 6).shouldRetry).toBe(false);
    });

    it('doubles delay with each attempt', () => {
      expect(evalRetryPolicy(policy, 1).delayMs).toBe(1000);
      expect(evalRetryPolicy(policy, 2).delayMs).toBe(2000);
      expect(evalRetryPolicy(policy, 3).delayMs).toBe(4000);
      expect(evalRetryPolicy(policy, 4).delayMs).toBe(8000);
    });

    it('caps delay at 5 minutes', () => {
      const bigPolicy = { retries: 20, backoff: 'exponential' as const, baseDelayMs: 1000 };
      expect(evalRetryPolicy(bigPolicy, 15).delayMs).toBeLessThanOrEqual(5 * 60 * 1000);
    });
  });

  describe('zero retries', () => {
    const policy = { retries: 0, backoff: 'fixed' as const, baseDelayMs: 1000 };

    it('never allows retry', () => {
      expect(evalRetryPolicy(policy, 1).shouldRetry).toBe(false);
    });
  });
});

describe('isTimedOut', () => {
  it('returns false when elapsed time is less than timeout', () => {
    const startedAt = new Date(1000);
    const now = new Date(5000);
    expect(isTimedOut(startedAt, 10_000, now)).toBe(false);
  });

  it('returns true when elapsed time equals timeout', () => {
    const startedAt = new Date(1000);
    const now = new Date(11_000);
    expect(isTimedOut(startedAt, 10_000, now)).toBe(true);
  });

  it('returns true when elapsed time exceeds timeout', () => {
    const startedAt = new Date(1000);
    const now = new Date(20_000);
    expect(isTimedOut(startedAt, 10_000, now)).toBe(true);
  });
});
