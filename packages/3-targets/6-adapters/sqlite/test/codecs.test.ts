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

    it('round-trips strings', async () => {
      expect(await codec.decode(await codec.encode!('hello'))).toBe('hello');
    });

    it('handles empty string', async () => {
      expect(await codec.decode(await codec.encode!(''))).toBe('');
    });
  });

  describe('integer codec', () => {
    const codec = codecDefinitions.integer.codec;

    it('has correct id', () => {
      expect(codec.id).toBe(SQLITE_INTEGER_CODEC_ID);
    });

    it('round-trips numbers', async () => {
      expect(await codec.decode(await codec.encode!(42))).toBe(42);
      expect(await codec.decode(await codec.encode!(0))).toBe(0);
      expect(await codec.decode(await codec.encode!(-1))).toBe(-1);
    });
  });

  describe('real codec', () => {
    const codec = codecDefinitions.real.codec;

    it('has correct id', () => {
      expect(codec.id).toBe(SQLITE_REAL_CODEC_ID);
    });

    it('round-trips floats', async () => {
      expect(await codec.decode(await codec.encode!(3.14))).toBeCloseTo(3.14);
      expect(await codec.decode(await codec.encode!(0.0))).toBe(0);
    });
  });

  describe('blob codec', () => {
    const codec = codecDefinitions.blob.codec;

    it('has correct id', () => {
      expect(codec.id).toBe(SQLITE_BLOB_CODEC_ID);
    });

    it('round-trips Uint8Array', async () => {
      const input = new Uint8Array([1, 2, 3, 4]);
      expect(await codec.decode(await codec.encode!(input))).toEqual(input);
    });

    it('handles empty Uint8Array', async () => {
      const input = new Uint8Array([]);
      expect(await codec.decode(await codec.encode!(input))).toEqual(input);
    });
  });

  describe('boolean codec', () => {
    const codec = codecDefinitions.boolean.codec;

    it('has correct id', () => {
      expect(codec.id).toBe(SQLITE_BOOLEAN_CODEC_ID);
    });

    it('encodes true as 1', async () => {
      expect(await codec.encode!(true)).toBe(1);
    });

    it('encodes false as 0', async () => {
      expect(await codec.encode!(false)).toBe(0);
    });

    it('decodes 1 as true', async () => {
      expect(await codec.decode(1)).toBe(true);
    });

    it('decodes 0 as false', async () => {
      expect(await codec.decode(0)).toBe(false);
    });

    it('decodes nonzero as true', async () => {
      expect(await codec.decode(42)).toBe(true);
    });
  });

  describe('datetime codec', () => {
    const codec = codecDefinitions.datetime.codec;

    it('has correct id', () => {
      expect(codec.id).toBe(SQLITE_DATETIME_CODEC_ID);
    });

    it('encodes Date to ISO8601 string', async () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      expect(await codec.encode!(date)).toBe('2024-01-15T10:30:00.000Z');
    });

    it('decodes ISO8601 string to Date', async () => {
      const result = await codec.decode('2024-01-15T10:30:00.000Z');
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });

    it('round-trips dates', async () => {
      const date = new Date('2024-06-15T23:59:59.999Z');
      const wire = await codec.encode!(date);
      const decoded = await codec.decode(wire);
      expect(decoded.getTime()).toBe(date.getTime());
    });

    it('handles date without timezone (treated as UTC by Date constructor)', async () => {
      const result = await codec.decode('2024-01-15T10:30:00');
      expect(result).toBeInstanceOf(Date);
    });
  });

  describe('json codec', () => {
    const codec = codecDefinitions.json.codec;

    it('has correct id', () => {
      expect(codec.id).toBe(SQLITE_JSON_CODEC_ID);
    });

    it('encodes object to JSON string', async () => {
      const value = { name: 'alice', age: 30 };
      expect(await codec.encode!(value)).toBe('{"name":"alice","age":30}');
    });

    it('decodes JSON string to object', async () => {
      expect(await codec.decode('{"name":"alice"}')).toEqual({ name: 'alice' });
    });

    it('round-trips nested objects', async () => {
      const value = { a: { b: { c: [1, 2, 3] } } };
      expect(await codec.decode(await codec.encode!(value))).toEqual(value);
    });

    it('round-trips arrays', async () => {
      const value = [1, 'two', true, null];
      expect(await codec.decode(await codec.encode!(value))).toEqual(value);
    });

    it('round-trips null', async () => {
      expect(await codec.decode(await codec.encode!(null))).toBeNull();
    });

    it('handles already-parsed objects from wire', async () => {
      const parsed = { key: 'value' };
      // SQLite may return already-parsed JSON objects from the wire
      expect(await codec.decode(parsed as unknown as string)).toEqual(parsed);
    });
  });

  describe('bigint codec', () => {
    const codec = codecDefinitions.bigint.codec;

    it('has correct id', () => {
      expect(codec.id).toBe(SQLITE_BIGINT_CODEC_ID);
    });

    it('encodes bigint', async () => {
      expect(await codec.encode!(42n)).toBe(42n);
    });

    it('decodes number to bigint', async () => {
      expect(await codec.decode(42)).toBe(42n);
    });

    it('decodes bigint to bigint', async () => {
      expect(await codec.decode(42n)).toBe(42n);
    });

    it('handles large integers', async () => {
      const large = 9007199254740993n;
      expect(await codec.decode(await codec.encode!(large))).toBe(large);
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
