import { describe, expect, it } from 'vitest';
import {
  pgBitDescriptor,
  pgBoolDescriptor,
  pgByteaDescriptor,
  pgCharDescriptor,
  pgEnumDescriptor,
  pgFloat4Descriptor,
  pgFloat8Descriptor,
  pgInt2Descriptor,
  pgInt4Descriptor,
  pgInt8Descriptor,
  pgIntervalDescriptor,
  pgJsonbDescriptor,
  pgJsonDescriptor,
  pgNumericDescriptor,
  pgTextDescriptor,
  pgTimeDescriptor,
  pgTimestampDescriptor,
  pgTimestamptzDescriptor,
  pgTimetzDescriptor,
  pgVarbitDescriptor,
  pgVarcharDescriptor,
} from '../src/core/codecs';

const instanceCtx = { name: '<test>' };

describe('renderSqlLiteral on Postgres codecs', () => {
  describe('pg/text@1', () => {
    const codec = pgTextDescriptor.factory()(instanceCtx);

    it('renders ASCII strings', () => {
      expect(codec.renderSqlLiteral('hello')).toBe("'hello'::text");
    });

    it('doubles embedded single quotes', () => {
      expect(codec.renderSqlLiteral("O'Brien")).toBe("'O''Brien'::text");
    });

    it('preserves backslashes verbatim', () => {
      expect(codec.renderSqlLiteral('a\\b')).toBe("'a\\b'::text");
    });

    it('rejects NULL bytes', () => {
      expect(() => codec.renderSqlLiteral('a\0b')).toThrow();
    });

    it('passes unicode through verbatim', () => {
      expect(codec.renderSqlLiteral('naïve résumé 日本語')).toBe("'naïve résumé 日本語'::text");
    });
  });

  describe('pg/int4@1', () => {
    const codec = pgInt4Descriptor.factory()(instanceCtx);

    it('renders integers as numeric literals', () => {
      expect(codec.renderSqlLiteral(42)).toBe('42');
    });

    it('renders negative integers', () => {
      expect(codec.renderSqlLiteral(-7)).toBe('-7');
    });

    it('renders zero', () => {
      expect(codec.renderSqlLiteral(0)).toBe('0');
    });
  });

  describe('pg/int2@1', () => {
    const codec = pgInt2Descriptor.factory()(instanceCtx);

    it('renders integers', () => {
      expect(codec.renderSqlLiteral(7)).toBe('7');
    });
  });

  describe('pg/int8@1', () => {
    const codec = pgInt8Descriptor.factory()(instanceCtx);

    it('renders integers', () => {
      expect(codec.renderSqlLiteral(123456789)).toBe('123456789');
    });
  });

  describe('pg/float4@1', () => {
    const codec = pgFloat4Descriptor.factory()(instanceCtx);

    it('renders floats', () => {
      expect(codec.renderSqlLiteral(3.14)).toBe('3.14');
    });
  });

  describe('pg/float8@1', () => {
    const codec = pgFloat8Descriptor.factory()(instanceCtx);

    it('renders doubles', () => {
      expect(codec.renderSqlLiteral(1.234567890123)).toBe('1.234567890123');
    });
  });

  describe('pg/bool@1', () => {
    const codec = pgBoolDescriptor.factory()(instanceCtx);

    it('renders true as TRUE', () => {
      expect(codec.renderSqlLiteral(true)).toBe('TRUE');
    });

    it('renders false as FALSE', () => {
      expect(codec.renderSqlLiteral(false)).toBe('FALSE');
    });
  });

  describe('pg/numeric@1', () => {
    const codec = pgNumericDescriptor.factory({ precision: 10, scale: 2 })(instanceCtx);

    it('renders decimal strings with numeric cast', () => {
      expect(codec.renderSqlLiteral('3.14')).toBe("'3.14'::numeric");
    });

    it('escapes embedded single quotes', () => {
      // Defensive — numeric values shouldn't contain quotes, but the renderer escapes for safety.
      expect(codec.renderSqlLiteral("12'34")).toBe("'12''34'::numeric");
    });
  });

  describe('pg/timestamp@1', () => {
    const codec = pgTimestampDescriptor.factory({})(instanceCtx);

    it('renders Date with timestamp cast', () => {
      const d = new Date('2026-04-30T12:34:56.789Z');
      expect(codec.renderSqlLiteral(d)).toBe(
        "'2026-04-30T12:34:56.789Z'::timestamp without time zone",
      );
    });
  });

  describe('pg/timestamptz@1', () => {
    const codec = pgTimestamptzDescriptor.factory({})(instanceCtx);

    it('renders Date with timestamptz cast', () => {
      const d = new Date('2026-04-30T12:34:56.789Z');
      expect(codec.renderSqlLiteral(d)).toBe(
        "'2026-04-30T12:34:56.789Z'::timestamp with time zone",
      );
    });
  });

  describe('pg/time@1', () => {
    const codec = pgTimeDescriptor.factory({})(instanceCtx);

    it('renders time strings', () => {
      expect(codec.renderSqlLiteral('12:34:56')).toBe("'12:34:56'::time");
    });
  });

  describe('pg/timetz@1', () => {
    const codec = pgTimetzDescriptor.factory({})(instanceCtx);

    it('renders time-with-timezone strings', () => {
      expect(codec.renderSqlLiteral('12:34:56+02')).toBe("'12:34:56+02'::timetz");
    });
  });

  describe('pg/bit@1', () => {
    const codec = pgBitDescriptor.factory({})(instanceCtx);

    it('renders bit strings', () => {
      expect(codec.renderSqlLiteral('1010')).toBe("B'1010'");
    });
  });

  describe('pg/varbit@1', () => {
    const codec = pgVarbitDescriptor.factory({})(instanceCtx);

    it('renders variable-bit strings', () => {
      expect(codec.renderSqlLiteral('10101')).toBe("B'10101'");
    });
  });

  describe('pg/bytea@1', () => {
    const codec = pgByteaDescriptor.factory()(instanceCtx);

    it('renders Uint8Array as hex-formatted bytea literal', () => {
      expect(codec.renderSqlLiteral(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe(
        "'\\xdeadbeef'::bytea",
      );
    });

    it('renders empty arrays', () => {
      expect(codec.renderSqlLiteral(new Uint8Array([]))).toBe("'\\x'::bytea");
    });
  });

  describe('pg/interval@1', () => {
    const codec = pgIntervalDescriptor.factory({})(instanceCtx);

    it('renders interval strings with cast', () => {
      expect(codec.renderSqlLiteral('1 day')).toBe("'1 day'::interval");
    });

    it('escapes embedded single quotes', () => {
      expect(codec.renderSqlLiteral("1 day'")).toBe("'1 day'''::interval");
    });
  });

  describe('pg/enum@1', () => {
    const codec = pgEnumDescriptor.factory({})(instanceCtx);

    it('renders enum values as bare quoted literals (column-context cast)', () => {
      expect(codec.renderSqlLiteral('active')).toBe("'active'");
    });

    it('escapes embedded single quotes', () => {
      expect(codec.renderSqlLiteral("a'b")).toBe("'a''b'");
    });
  });

  describe('pg/json@1', () => {
    const codec = pgJsonDescriptor.factory()(instanceCtx);

    it('renders JSON objects as quoted JSON with json cast', () => {
      expect(codec.renderSqlLiteral({ a: 1 })).toBe('\'{"a":1}\'::json');
    });

    it('renders JSON arrays', () => {
      expect(codec.renderSqlLiteral([1, 2, 3])).toBe("'[1,2,3]'::json");
    });

    it('escapes single quotes inside string values', () => {
      expect(codec.renderSqlLiteral({ msg: "O'Brien" })).toBe('\'{"msg":"O\'\'Brien"}\'::json');
    });
  });

  describe('pg/jsonb@1', () => {
    const codec = pgJsonbDescriptor.factory()(instanceCtx);

    it('renders JSON objects as quoted JSON with jsonb cast', () => {
      expect(codec.renderSqlLiteral({ a: 1 })).toBe('\'{"a":1}\'::jsonb');
    });

    it('renders strings', () => {
      expect(codec.renderSqlLiteral('hello')).toBe('\'"hello"\'::jsonb');
    });
  });

  describe('pg/char@1 (aliased over SqlCharCodec)', () => {
    const codec = pgCharDescriptor.factory({})(instanceCtx);

    it('renders fixed-length strings as character literals', () => {
      expect(codec.renderSqlLiteral('a')).toBe("'a'::character");
    });
  });

  describe('pg/varchar@1 (aliased over SqlVarcharCodec)', () => {
    const codec = pgVarcharDescriptor.factory({})(instanceCtx);

    it('renders variable-length strings as character-varying literals', () => {
      expect(codec.renderSqlLiteral('hello')).toBe("'hello'::character varying");
    });
  });
});
