import { describe, expect, it } from 'vitest';
import {
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
  SQLITE_BOOLEAN_CODEC_ID,
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
  SQLITE_REAL_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
} from '../src/core/codec-ids';
import { codecDefinitions } from '../src/core/codecs';

describe('SQLite codecs', () => {
  describe('text codec', () => {
    const codec = codecDefinitions.text.codec;

    it('has correct id', () => {
      expect(codec.id).toBe(SQLITE_TEXT_CODEC_ID);
    });

    it('round-trips strings', () => {
      expect(codec.decode(codec.encode!('hello'))).toBe('hello');
    });

    it('handles empty string', () => {
      expect(codec.decode(codec.encode!(''))).toBe('');
    });
  });

  describe('integer codec', () => {
    const codec = codecDefinitions.integer.codec;

    it('has correct id', () => {
      expect(codec.id).toBe(SQLITE_INTEGER_CODEC_ID);
    });

    it('round-trips numbers', () => {
      expect(codec.decode(codec.encode!(42))).toBe(42);
      expect(codec.decode(codec.encode!(0))).toBe(0);
      expect(codec.decode(codec.encode!(-1))).toBe(-1);
    });
  });

  describe('real codec', () => {
    const codec = codecDefinitions.real.codec;

    it('has correct id', () => {
      expect(codec.id).toBe(SQLITE_REAL_CODEC_ID);
    });

    it('round-trips floats', () => {
      expect(codec.decode(codec.encode!(3.14))).toBeCloseTo(3.14);
      expect(codec.decode(codec.encode!(0.0))).toBe(0);
    });
  });

  describe('blob codec', () => {
    const codec = codecDefinitions.blob.codec;

    it('has correct id', () => {
      expect(codec.id).toBe(SQLITE_BLOB_CODEC_ID);
    });

    it('round-trips Uint8Array', () => {
      const input = new Uint8Array([1, 2, 3, 4]);
      expect(codec.decode(codec.encode!(input))).toEqual(input);
    });

    it('handles empty Uint8Array', () => {
      const input = new Uint8Array([]);
      expect(codec.decode(codec.encode!(input))).toEqual(input);
    });
  });

  describe('boolean codec', () => {
    const codec = codecDefinitions.boolean.codec;

    it('has correct id', () => {
      expect(codec.id).toBe(SQLITE_BOOLEAN_CODEC_ID);
    });

    it('encodes true as 1', () => {
      expect(codec.encode!(true)).toBe(1);
    });

    it('encodes false as 0', () => {
      expect(codec.encode!(false)).toBe(0);
    });

    it('decodes 1 as true', () => {
      expect(codec.decode(1)).toBe(true);
    });

    it('decodes 0 as false', () => {
      expect(codec.decode(0)).toBe(false);
    });

    it('decodes nonzero as true', () => {
      expect(codec.decode(42)).toBe(true);
    });
  });

  describe('datetime codec', () => {
    const codec = codecDefinitions.datetime.codec;

    it('has correct id', () => {
      expect(codec.id).toBe(SQLITE_DATETIME_CODEC_ID);
    });

    it('encodes Date to ISO8601 string', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      expect(codec.encode!(date)).toBe('2024-01-15T10:30:00.000Z');
    });

    it('decodes ISO8601 string to Date', () => {
      const result = codec.decode('2024-01-15T10:30:00.000Z');
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });

    it('round-trips dates', () => {
      const date = new Date('2024-06-15T23:59:59.999Z');
      const wire = codec.encode!(date);
      const decoded = codec.decode(wire);
      expect(decoded.getTime()).toBe(date.getTime());
    });

    it('handles date without timezone (treated as UTC by Date constructor)', () => {
      const result = codec.decode('2024-01-15T10:30:00');
      expect(result).toBeInstanceOf(Date);
    });
  });

  describe('json codec', () => {
    const codec = codecDefinitions.json.codec;

    it('has correct id', () => {
      expect(codec.id).toBe(SQLITE_JSON_CODEC_ID);
    });

    it('encodes object to JSON string', () => {
      const value = { name: 'alice', age: 30 };
      expect(codec.encode!(value)).toBe('{"name":"alice","age":30}');
    });

    it('decodes JSON string to object', () => {
      expect(codec.decode('{"name":"alice"}')).toEqual({ name: 'alice' });
    });

    it('round-trips nested objects', () => {
      const value = { a: { b: { c: [1, 2, 3] } } };
      expect(codec.decode(codec.encode!(value))).toEqual(value);
    });

    it('round-trips arrays', () => {
      const value = [1, 'two', true, null];
      expect(codec.decode(codec.encode!(value))).toEqual(value);
    });

    it('round-trips null', () => {
      expect(codec.decode(codec.encode!(null))).toBeNull();
    });

    it('handles already-parsed objects from wire', () => {
      const parsed = { key: 'value' };
      expect(codec.decode(parsed)).toEqual(parsed);
    });
  });

  describe('bigint codec', () => {
    const codec = codecDefinitions.bigint.codec;

    it('has correct id', () => {
      expect(codec.id).toBe(SQLITE_BIGINT_CODEC_ID);
    });

    it('encodes bigint', () => {
      expect(codec.encode!(42n)).toBe(42n);
    });

    it('decodes number to bigint', () => {
      expect(codec.decode(42)).toBe(42n);
    });

    it('decodes bigint to bigint', () => {
      expect(codec.decode(42n)).toBe(42n);
    });

    it('handles large integers', () => {
      const large = 9007199254740993n;
      expect(codec.decode(codec.encode!(large))).toBe(large);
    });
  });

  describe('codec definitions structure', () => {
    it('has all expected codecs', () => {
      const keys = Object.keys(codecDefinitions);
      expect(keys).toContain('text');
      expect(keys).toContain('integer');
      expect(keys).toContain('real');
      expect(keys).toContain('blob');
      expect(keys).toContain('boolean');
      expect(keys).toContain('datetime');
      expect(keys).toContain('json');
      expect(keys).toContain('bigint');
      // Standard SQL codecs inherited
      expect(keys).toContain('char');
      expect(keys).toContain('varchar');
      expect(keys).toContain('int');
      expect(keys).toContain('float');
    });
  });
});
