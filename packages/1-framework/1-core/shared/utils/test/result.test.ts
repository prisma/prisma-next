import { describe, expect, it } from 'vitest';
import { notOk, ok, okVoid } from '../src/result';

describe('result', () => {
  describe('ok()', () => {
    it('creates a successful result with a value', () => {
      const result = ok(42);
      expect(result).toMatchObject({ ok: true, value: 42 });
    });

    it('creates a frozen result', () => {
      const result = ok('test');
      expect(Object.isFrozen(result)).toBe(true);
    });
  });

  describe('notOk()', () => {
    it('creates an unsuccessful result with failure details', () => {
      const result = notOk({ code: 'ERR_TEST', message: 'Test error' });
      expect(result).toMatchObject({
        ok: false,
        failure: { code: 'ERR_TEST', message: 'Test error' },
      });
    });

    it('creates a frozen result', () => {
      const result = notOk('error');
      expect(Object.isFrozen(result)).toBe(true);
    });
  });

  describe('okVoid()', () => {
    it('returns a successful void result', () => {
      const result = okVoid();
      expect(result.ok).toBe(true);
      expect(result.value).toBeUndefined();
    });

    it('returns the same singleton instance', () => {
      const result1 = okVoid();
      const result2 = okVoid();
      expect(result1).toBe(result2);
    });
  });
});
