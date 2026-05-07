import { describe, expect, it } from 'vitest';
import {
  SQL_CHAR_CODEC_ID,
  SQL_FLOAT_CODEC_ID,
  SQL_INT_CODEC_ID,
  SQL_TEXT_CODEC_ID,
  SQL_TIMESTAMP_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
} from '../../src/ast/sql-codecs';
import {
  sqlCharDescriptorClass,
  sqlFloatDescriptorClass,
  sqlIntDescriptorClass,
  sqlTextDescriptorClass,
  sqlTimestampDescriptorClass,
  sqlVarcharDescriptorClass,
} from '../../src/ast/sql-codecs-class';

const instanceCtx = { name: '<test>' };
const callCtx = {};

describe('sql-codecs-class', () => {
  describe('sql/text@1', () => {
    const codec = sqlTextDescriptorClass.factory()(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(SQL_TEXT_CODEC_ID);
    });

    it('encodes and decodes string values', async () => {
      expect(await codec.encode('hello', callCtx)).toBe('hello');
      expect(await codec.decode('hello', callCtx)).toBe('hello');
    });

    it('round-trips through JSON identity', () => {
      expect(codec.encodeJson('hello')).toBe('hello');
      expect(codec.decodeJson('hello')).toBe('hello');
    });
  });

  describe('sql/int@1', () => {
    const codec = sqlIntDescriptorClass.factory()(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(SQL_INT_CODEC_ID);
    });

    it('encodes and decodes number values', async () => {
      expect(await codec.encode(42, callCtx)).toBe(42);
      expect(await codec.decode(42, callCtx)).toBe(42);
    });
  });

  describe('sql/float@1', () => {
    const codec = sqlFloatDescriptorClass.factory()(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(SQL_FLOAT_CODEC_ID);
    });

    it('encodes and decodes number values', async () => {
      expect(await codec.encode(3.14, callCtx)).toBe(3.14);
      expect(await codec.decode(3.14, callCtx)).toBe(3.14);
    });
  });

  describe('sql/char@1', () => {
    const codec = sqlCharDescriptorClass.factory({ length: 8 })(instanceCtx);

    it('id proxies through the descriptor (independent of params)', () => {
      expect(codec.id).toBe(SQL_CHAR_CODEC_ID);
    });

    it('encodes string values verbatim', async () => {
      expect(await codec.encode('user_001', callCtx)).toBe('user_001');
    });

    it('trims trailing spaces on decode', async () => {
      expect(await codec.decode('user_001                            ', callCtx)).toBe('user_001');
      expect(await codec.decode('user_001', callCtx)).toBe('user_001');
    });

    it('renderOutputType returns Char<length>', () => {
      expect(sqlCharDescriptorClass.renderOutputType?.({ length: 36 })).toBe('Char<36>');
    });

    it('renderOutputType returns undefined when length absent', () => {
      expect(sqlCharDescriptorClass.renderOutputType?.({})).toBeUndefined();
    });
  });

  describe('sql/varchar@1', () => {
    const codec = sqlVarcharDescriptorClass.factory({ length: 255 })(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(SQL_VARCHAR_CODEC_ID);
    });

    it('encodes and decodes string values verbatim', async () => {
      expect(await codec.encode('hello', callCtx)).toBe('hello');
      expect(await codec.decode('hello', callCtx)).toBe('hello');
    });

    it('renderOutputType returns Varchar<length>', () => {
      expect(sqlVarcharDescriptorClass.renderOutputType?.({ length: 255 })).toBe('Varchar<255>');
    });
  });

  describe('sql/timestamp@1', () => {
    const codec = sqlTimestampDescriptorClass.factory({ precision: 3 })(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(SQL_TIMESTAMP_CODEC_ID);
    });

    it('round-trips Date values', async () => {
      const instant = new Date('2024-01-15T10:30:00Z');
      expect(await codec.encode(instant, callCtx)).toBe(instant);
      expect(await codec.decode(instant, callCtx)).toBe(instant);
    });

    it('serializes Date to ISO 8601 string for JSON', () => {
      const instant = new Date('2024-01-15T10:30:00Z');
      expect(codec.encodeJson(instant)).toBe('2024-01-15T10:30:00.000Z');
      expect(codec.decodeJson('2024-01-15T10:30:00.000Z')).toEqual(instant);
    });

    it('throws on invalid JSON input', () => {
      expect(() => codec.decodeJson(42)).toThrow(/Expected ISO date string/);
      expect(() => codec.decodeJson('not-a-date')).toThrow(/Invalid ISO date string/);
    });

    it('renderOutputType returns Timestamp<precision>', () => {
      expect(sqlTimestampDescriptorClass.renderOutputType?.({ precision: 3 })).toBe('Timestamp<3>');
    });

    it('renderOutputType returns bare Timestamp when precision absent', () => {
      expect(sqlTimestampDescriptorClass.renderOutputType?.({})).toBe('Timestamp');
    });
  });

  describe('descriptor metadata', () => {
    it('codec ids match the SQL_*_CODEC_ID constants', () => {
      expect(sqlTextDescriptorClass.codecId).toBe(SQL_TEXT_CODEC_ID);
      expect(sqlIntDescriptorClass.codecId).toBe(SQL_INT_CODEC_ID);
      expect(sqlFloatDescriptorClass.codecId).toBe(SQL_FLOAT_CODEC_ID);
      expect(sqlCharDescriptorClass.codecId).toBe(SQL_CHAR_CODEC_ID);
      expect(sqlVarcharDescriptorClass.codecId).toBe(SQL_VARCHAR_CODEC_ID);
      expect(sqlTimestampDescriptorClass.codecId).toBe(SQL_TIMESTAMP_CODEC_ID);
    });

    it('exposes traits and targetTypes for each codec', () => {
      expect(sqlTextDescriptorClass.traits).toEqual(['equality', 'order', 'textual']);
      expect(sqlTextDescriptorClass.targetTypes).toEqual(['text']);

      expect(sqlIntDescriptorClass.traits).toEqual(['equality', 'order', 'numeric']);
      expect(sqlIntDescriptorClass.targetTypes).toEqual(['int']);

      expect(sqlFloatDescriptorClass.traits).toEqual(['equality', 'order', 'numeric']);
      expect(sqlFloatDescriptorClass.targetTypes).toEqual(['float']);

      expect(sqlCharDescriptorClass.targetTypes).toEqual(['char']);
      expect(sqlVarcharDescriptorClass.targetTypes).toEqual(['varchar']);
      expect(sqlTimestampDescriptorClass.targetTypes).toEqual(['timestamp']);
    });
  });
});
