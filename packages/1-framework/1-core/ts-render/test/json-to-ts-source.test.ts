import { describe, expect, it } from 'vitest';

import { jsonToTsSource } from '../src/json-to-ts-source';

describe('jsonToTsSource', () => {
  describe('JSON-compatible values', () => {
    it('renders primitives', () => {
      expect(jsonToTsSource(null)).toBe('null');
      expect(jsonToTsSource(undefined)).toBe('undefined');
      expect(jsonToTsSource('hello')).toBe('"hello"');
      expect(jsonToTsSource(42)).toBe('42');
      expect(jsonToTsSource(true)).toBe('true');
      expect(jsonToTsSource(false)).toBe('false');
    });

    it('renders arrays', () => {
      expect(jsonToTsSource([])).toBe('[]');
      expect(jsonToTsSource([1, 2, 3])).toBe('[1, 2, 3]');
    });

    it('renders objects and quotes non-identifier keys', () => {
      expect(jsonToTsSource({ a: 1, 'weird-key': 2 })).toBe('{ a: 1, "weird-key": 2 }');
    });

    it('drops object entries whose value is undefined', () => {
      expect(jsonToTsSource({ a: undefined })).toBe('{}');
      expect(jsonToTsSource({ a: 1, b: undefined })).toBe('{ a: 1 }');
    });
  });

  describe('non-JSON inputs bounds', () => {
    // The `unknown` input type is a documented ergonomic concession (so structural
    // types whose fields happen to be JSON-compatible can be passed without an
    // index signature). The escape hatch is explicitly bounded by a runtime throw
    // whenever the actual value is outside the JSON universe — codecs must encode
    // first (see the module docstring).
    it('throws on Symbol', () => {
      expect(() => jsonToTsSource(Symbol('s'))).toThrowError(/unsupported value type "symbol"/);
    });

    it('throws on BigInt', () => {
      expect(() => jsonToTsSource(BigInt(1))).toThrowError(/unsupported value type "bigint"/);
    });

    it('throws on function', () => {
      expect(() => jsonToTsSource(() => 1)).toThrowError(/unsupported value type "function"/);
    });
  });
});
