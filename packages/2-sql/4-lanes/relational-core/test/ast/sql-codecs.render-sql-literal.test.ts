import { describe, expect, it } from 'vitest';
import {
  sqlCharDescriptor,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlTextDescriptor,
  sqlTimestampDescriptor,
  sqlVarcharDescriptor,
} from '../../src/ast/sql-codecs';

const instanceCtx = { name: '<test>' };

describe('renderSqlLiteral on SQL base codecs', () => {
  describe('sql/text@1', () => {
    const codec = sqlTextDescriptor.factory()(instanceCtx);

    it('renders ASCII strings as quoted literals', () => {
      expect(codec.renderSqlLiteral('hello')).toBe("'hello'");
    });

    it('doubles embedded single quotes', () => {
      expect(codec.renderSqlLiteral("O'Brien")).toBe("'O''Brien'");
    });

    it('preserves backslashes as literal characters', () => {
      expect(codec.renderSqlLiteral('a\\b')).toBe("'a\\b'");
    });

    it('rejects NULL bytes', () => {
      expect(() => codec.renderSqlLiteral('a\0b')).toThrow();
    });

    it('passes unicode characters through verbatim', () => {
      expect(codec.renderSqlLiteral('naïve résumé 日本語')).toBe("'naïve résumé 日本語'");
    });
  });

  describe('sql/char@1', () => {
    const codec = sqlCharDescriptor.factory({})(instanceCtx);

    it('renders fixed-length strings as quoted literals', () => {
      expect(codec.renderSqlLiteral('abc')).toBe("'abc'");
    });

    it('escapes embedded single quotes', () => {
      expect(codec.renderSqlLiteral("a'b")).toBe("'a''b'");
    });
  });

  describe('sql/varchar@1', () => {
    const codec = sqlVarcharDescriptor.factory({})(instanceCtx);

    it('renders variable-length strings as quoted literals', () => {
      expect(codec.renderSqlLiteral('hello')).toBe("'hello'");
    });

    it('escapes embedded single quotes', () => {
      expect(codec.renderSqlLiteral("a'b")).toBe("'a''b'");
    });
  });

  describe('sql/int@1', () => {
    const codec = sqlIntDescriptor.factory()(instanceCtx);

    it('renders integers as numeric literals', () => {
      expect(codec.renderSqlLiteral(42)).toBe('42');
    });

    it('renders zero', () => {
      expect(codec.renderSqlLiteral(0)).toBe('0');
    });

    it('renders negative integers', () => {
      expect(codec.renderSqlLiteral(-7)).toBe('-7');
    });
  });

  describe('sql/float@1', () => {
    const codec = sqlFloatDescriptor.factory()(instanceCtx);

    it('renders floats as numeric literals', () => {
      expect(codec.renderSqlLiteral(3.14)).toBe('3.14');
    });

    it('renders integral floats', () => {
      expect(codec.renderSqlLiteral(1)).toBe('1');
    });
  });

  describe('sql/timestamp@1', () => {
    const codec = sqlTimestampDescriptor.factory({})(instanceCtx);

    it('renders Date values as ISO-8601 string literals', () => {
      const d = new Date('2026-04-30T12:34:56.789Z');
      expect(codec.renderSqlLiteral(d)).toBe("'2026-04-30T12:34:56.789Z'");
    });

    it('renders epoch as ISO literal', () => {
      expect(codec.renderSqlLiteral(new Date(0))).toBe("'1970-01-01T00:00:00.000Z'");
    });
  });
});
