import { describe, expect, it } from 'vitest';
import {
  sqliteBigintDescriptor,
  sqliteBlobDescriptor,
  sqliteDatetimeDescriptor,
  sqliteIntegerDescriptor,
  sqliteJsonDescriptor,
  sqliteRealDescriptor,
  sqliteTextDescriptor,
} from '../src/core/codecs';

const instanceCtx = { name: '<test>' };

describe('renderSqlLiteral on SQLite codecs', () => {
  describe('sqlite/text@1', () => {
    const codec = sqliteTextDescriptor.factory()(instanceCtx);

    it('renders ASCII strings as quoted literals', () => {
      expect(codec.renderSqlLiteral('hello')).toBe("'hello'");
    });

    it('doubles embedded single quotes', () => {
      expect(codec.renderSqlLiteral("O'Brien")).toBe("'O''Brien'");
    });

    it('preserves backslashes verbatim', () => {
      expect(codec.renderSqlLiteral('a\\b')).toBe("'a\\b'");
    });

    it('rejects NULL bytes', () => {
      expect(() => codec.renderSqlLiteral('a\0b')).toThrow();
    });

    it('passes unicode through verbatim', () => {
      expect(codec.renderSqlLiteral('naïve résumé 日本語')).toBe("'naïve résumé 日本語'");
    });
  });

  describe('sqlite/integer@1', () => {
    const codec = sqliteIntegerDescriptor.factory()(instanceCtx);

    it('renders integers as numeric literals', () => {
      expect(codec.renderSqlLiteral(42)).toBe('42');
    });

    it('renders negatives', () => {
      expect(codec.renderSqlLiteral(-7)).toBe('-7');
    });

    it('renders zero', () => {
      expect(codec.renderSqlLiteral(0)).toBe('0');
    });

    it('carries the autoincrement trait via descriptor', () => {
      expect(sqliteIntegerDescriptor.traits).toContain('autoincrement');
    });
  });

  describe('sqlite/real@1', () => {
    const codec = sqliteRealDescriptor.factory()(instanceCtx);

    it('renders floats as numeric literals', () => {
      expect(codec.renderSqlLiteral(3.14)).toBe('3.14');
    });
  });

  describe('sqlite/blob@1', () => {
    const codec = sqliteBlobDescriptor.factory()(instanceCtx);

    it('renders Uint8Array as a sqlite hex blob literal', () => {
      expect(codec.renderSqlLiteral(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe("X'deadbeef'");
    });

    it('renders empty blobs', () => {
      expect(codec.renderSqlLiteral(new Uint8Array([]))).toBe("X''");
    });
  });

  describe('sqlite/datetime@1', () => {
    const codec = sqliteDatetimeDescriptor.factory()(instanceCtx);

    it('renders Date as ISO-8601 string literal', () => {
      expect(codec.renderSqlLiteral(new Date('2026-04-30T12:34:56.789Z'))).toBe(
        "'2026-04-30T12:34:56.789Z'",
      );
    });
  });

  describe('sqlite/json@1', () => {
    const codec = sqliteJsonDescriptor.factory()(instanceCtx);

    it('renders JSON objects as quoted JSON strings', () => {
      expect(codec.renderSqlLiteral({ a: 1 })).toBe('\'{"a":1}\'');
    });

    it('escapes embedded single quotes inside JSON string values', () => {
      expect(codec.renderSqlLiteral({ msg: "O'Brien" })).toBe('\'{"msg":"O\'\'Brien"}\'');
    });
  });

  describe('sqlite/bigint@1', () => {
    const codec = sqliteBigintDescriptor.factory()(instanceCtx);

    it('renders bigints as numeric literals', () => {
      expect(codec.renderSqlLiteral(9007199254740993n)).toBe('9007199254740993');
    });

    it('renders negative bigints', () => {
      expect(codec.renderSqlLiteral(-42n)).toBe('-42');
    });

    it('does NOT carry the autoincrement trait (sqlite limits autoincrement to INTEGER PRIMARY KEY)', () => {
      expect(sqliteBigintDescriptor.traits).not.toContain('autoincrement');
    });
  });
});
