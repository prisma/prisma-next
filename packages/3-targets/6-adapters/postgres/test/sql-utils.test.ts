import { describe, expect, it, vi } from 'vitest';
import {
  escapeLiteral,
  qualifyName,
  quoteIdentifier,
  SqlEscapeError,
  validateEnumValueLength,
} from '../src/core/sql-utils';

describe('quoteIdentifier', () => {
  it('quotes simple identifiers', () => {
    expect(quoteIdentifier('user')).toBe('"user"');
    expect(quoteIdentifier('table_name')).toBe('"table_name"');
  });

  it('escapes double quotes by doubling them', () => {
    expect(quoteIdentifier('table"name')).toBe('"table""name"');
    expect(quoteIdentifier('a"b"c')).toBe('"a""b""c"');
  });

  it('handles special characters safely', () => {
    expect(quoteIdentifier("table'name")).toBe('"table\'name"');
    expect(quoteIdentifier('table\\name')).toBe('"table\\name"');
    expect(quoteIdentifier('table\nname')).toBe('"table\nname"');
    expect(quoteIdentifier('table;DROP TABLE users;--')).toBe('"table;DROP TABLE users;--"');
  });

  it('throws SqlEscapeError for null bytes', () => {
    expect(() => quoteIdentifier('table\0name')).toThrow(SqlEscapeError);
    expect(() => quoteIdentifier('table\0name')).toThrow('Identifier cannot contain null bytes');
  });

  it('throws SqlEscapeError for empty identifiers', () => {
    expect(() => quoteIdentifier('')).toThrow(SqlEscapeError);
    expect(() => quoteIdentifier('')).toThrow('Identifier cannot be empty');
  });

  it('includes sanitized value in error', () => {
    try {
      quoteIdentifier('table\0name');
    } catch (error) {
      expect(error).toBeInstanceOf(SqlEscapeError);
      expect((error as SqlEscapeError).value).toBe('table\\0name');
      expect((error as SqlEscapeError).kind).toBe('identifier');
    }
  });

  it('warns when identifier exceeds length limit', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const identifier = 'a'.repeat(64);

    const result = quoteIdentifier(identifier);

    expect(result).toBe(`"${identifier}"`);
    expect(warnSpy).toHaveBeenCalledWith(
      `Identifier "${identifier.slice(0, 20)}..." exceeds PostgreSQL's 63-character limit and will be truncated`,
    );

    warnSpy.mockRestore();
  });
});

describe('escapeLiteral', () => {
  it('escapes simple strings', () => {
    expect(escapeLiteral('hello')).toBe('hello');
    expect(escapeLiteral('user@example.com')).toBe('user@example.com');
  });

  it('escapes single quotes by doubling them', () => {
    expect(escapeLiteral("it's")).toBe("it''s");
    expect(escapeLiteral("a'b'c")).toBe("a''b''c");
  });

  it('handles potential SQL injection patterns safely', () => {
    // These should all be safely escaped
    expect(escapeLiteral("'; DROP TABLE users; --")).toBe("''; DROP TABLE users; --");
    expect(escapeLiteral("1' OR '1'='1")).toBe("1'' OR ''1''=''1");
    expect(escapeLiteral("admin'--")).toBe("admin''--");
  });

  it('preserves backslashes (standard_conforming_strings=on)', () => {
    // In PostgreSQL with standard_conforming_strings=on (default since 9.1),
    // backslashes are treated literally, not as escape characters
    expect(escapeLiteral('path\\to\\file')).toBe('path\\to\\file');
    expect(escapeLiteral("value\\'test")).toBe("value\\''test");
  });

  it('handles newlines and other whitespace', () => {
    expect(escapeLiteral('line1\nline2')).toBe('line1\nline2');
    expect(escapeLiteral('col1\tcol2')).toBe('col1\tcol2');
  });

  it('throws SqlEscapeError for null bytes', () => {
    expect(() => escapeLiteral('value\0test')).toThrow(SqlEscapeError);
    expect(() => escapeLiteral('value\0test')).toThrow('Literal value cannot contain null bytes');
  });

  it('includes sanitized value in error', () => {
    try {
      escapeLiteral('value\0test');
    } catch (error) {
      expect(error).toBeInstanceOf(SqlEscapeError);
      expect((error as SqlEscapeError).value).toBe('value\\0test');
      expect((error as SqlEscapeError).kind).toBe('literal');
    }
  });
});

describe('qualifyName', () => {
  it('builds schema-qualified names', () => {
    expect(qualifyName('public', 'user')).toBe('"public"."user"');
    expect(qualifyName('my_schema', 'my_table')).toBe('"my_schema"."my_table"');
  });

  it('handles special characters in both parts', () => {
    expect(qualifyName('schema"name', 'table"name')).toBe('"schema""name"."table""name"');
  });

  it('propagates null byte errors', () => {
    expect(() => qualifyName('schema\0name', 'table')).toThrow(SqlEscapeError);
    expect(() => qualifyName('schema', 'table\0name')).toThrow(SqlEscapeError);
  });
});

describe('enum value security scenarios', () => {
  it('handles enum values with quotes safely', () => {
    // Simulating how enum values would be used in CREATE TYPE
    const values = ["it's", "don't", "can't"];
    const escaped = values.map((v) => `'${escapeLiteral(v)}'`).join(', ');
    expect(escaped).toBe("'it''s', 'don''t', 'can''t'");
  });

  it('handles enum values with SQL injection attempts', () => {
    const maliciousValues = ["active'); DROP TABLE users; --", "inactive' OR '1'='1", "pending\\'"];

    const escaped = maliciousValues.map((v) => `'${escapeLiteral(v)}'`).join(', ');
    expect(escaped).toBe(
      "'active''); DROP TABLE users; --', 'inactive'' OR ''1''=''1', 'pending\\'''",
    );
  });

  it('rejects enum values with null bytes', () => {
    const maliciousValue = 'active\0'; // null byte could truncate
    expect(() => escapeLiteral(maliciousValue)).toThrow(SqlEscapeError);
  });

  it('handles unicode enum values safely', () => {
    const unicodeValues = ['日本語', 'émoji 🎉', 'Ελληνικά'];
    const escaped = unicodeValues.map((v) => `'${escapeLiteral(v)}'`).join(', ');
    expect(escaped).toBe("'日本語', 'émoji 🎉', 'Ελληνικά'");
  });
});

describe('type name security scenarios', () => {
  it('handles type names with special characters', () => {
    expect(quoteIdentifier('Status_v2')).toBe('"Status_v2"');
    expect(quoteIdentifier('user-status')).toBe('"user-status"');
  });

  it('handles schema names with injection attempts', () => {
    const maliciousSchema = 'public"; DROP SCHEMA public; --';
    // The double quotes get escaped, preventing injection
    expect(quoteIdentifier(maliciousSchema)).toBe('"public""; DROP SCHEMA public; --"');
  });
});

describe('validateEnumValueLength', () => {
  it('accepts values within the limit', () => {
    expect(() => validateEnumValueLength('ok', 'Status')).not.toThrow();
  });

  it('throws when value exceeds the limit', () => {
    const longValue = 'a'.repeat(64);
    expect(() => validateEnumValueLength(longValue, 'Status')).toThrow(SqlEscapeError);
  });
});
