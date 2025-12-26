import { describe, expect, it } from 'vitest';
import { compact } from '../../src/ast/util';

describe('ast/util', () => {
  describe('compact', () => {
    it('removes undefined values', () => {
      const input = {
        a: 1,
        b: undefined,
        c: 2,
      };
      const result = compact(input);
      expect(result).toEqual({
        a: 1,
        c: 2,
      });
      expect('b' in result).toBe(false);
    });

    it('removes null values', () => {
      const input = {
        a: 1,
        b: null,
        c: 2,
      };
      const result = compact(input);
      expect(result).toEqual({
        a: 1,
        c: 2,
      });
      expect('b' in result).toBe(false);
    });

    it('removes empty arrays', () => {
      const input = {
        a: 1,
        b: [],
        c: [1, 2],
      };
      const result = compact(input);
      expect(result).toEqual({
        a: 1,
        c: [1, 2],
      });
      expect('b' in result).toBe(false);
    });

    it('keeps non-empty arrays', () => {
      const input = {
        a: [1, 2, 3],
        b: [],
      };
      const result = compact(input);
      expect(result).toEqual({
        a: [1, 2, 3],
      });
    });

    it('removes multiple undefined and null values', () => {
      const input = {
        a: 1,
        b: undefined,
        c: null,
        d: 2,
        e: undefined,
      };
      const result = compact(input);
      expect(result).toEqual({
        a: 1,
        d: 2,
      });
    });

    it('removes undefined, null, and empty arrays together', () => {
      const input = {
        a: 1,
        b: undefined,
        c: null,
        d: [],
        e: 2,
      };
      const result = compact(input);
      expect(result).toEqual({
        a: 1,
        e: 2,
      });
    });

    it('preserves all values when none are undefined, null, or empty arrays', () => {
      const input = {
        a: 1,
        b: 'test',
        c: [1, 2],
        d: { nested: true },
      };
      const result = compact(input);
      expect(result).toEqual(input);
    });

    it('handles empty object', () => {
      const input = {};
      const result = compact(input);
      expect(result).toEqual({});
    });

    it('handles object with only undefined values', () => {
      const input = {
        a: undefined,
        b: null,
        c: [],
      };
      const result = compact(input);
      expect(result).toEqual({});
    });

    it('preserves zero and false values', () => {
      const input = {
        a: 0,
        b: false,
        c: '',
      };
      const result = compact(input);
      expect(result).toEqual({
        a: 0,
        b: false,
        c: '',
      });
    });
  });
});
