import { describe, expect, it } from 'vitest';
import {
  PG_BIT_CODEC_ID,
  PG_BOOL_CODEC_ID,
  PG_ENUM_CODEC_ID,
  PG_FLOAT4_CODEC_ID,
  PG_FLOAT8_CODEC_ID,
  PG_INT2_CODEC_ID,
  PG_INT4_CODEC_ID,
  PG_INT8_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_JSON_CODEC_ID,
  PG_JSONB_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TIME_CODEC_ID,
  PG_TIMESTAMP_CODEC_ID,
  PG_TIMESTAMPTZ_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_VARBIT_CODEC_ID,
} from '../src/core/codec-ids';
import {
  pgBitDescriptorClass,
  pgBoolDescriptorClass,
  pgEnumDescriptorClass,
  pgFloat4DescriptorClass,
  pgFloat8DescriptorClass,
  pgInt2DescriptorClass,
  pgInt4DescriptorClass,
  pgInt8DescriptorClass,
  pgIntervalDescriptorClass,
  pgJsonbDescriptorClass,
  pgJsonDescriptorClass,
  pgNumericDescriptorClass,
  pgTextDescriptorClass,
  pgTimeDescriptorClass,
  pgTimestampDescriptorClass,
  pgTimestamptzDescriptorClass,
  pgTimetzDescriptorClass,
  pgVarbitDescriptorClass,
} from '../src/core/codecs-class';

const instanceCtx = { name: '<test>' };
const callCtx = {};

describe('codecs-class', () => {
  describe('pg/text@1', () => {
    const codec = pgTextDescriptorClass.factory()(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_TEXT_CODEC_ID);
    });

    it('encodes and decodes string values verbatim', async () => {
      expect(await codec.encode('hello', callCtx)).toBe('hello');
      expect(await codec.decode('hello', callCtx)).toBe('hello');
    });

    it('round-trips through JSON identity', () => {
      expect(codec.encodeJson('hello')).toBe('hello');
      expect(codec.decodeJson('hello')).toBe('hello');
    });
  });

  describe('pg/int4@1', () => {
    const codec = pgInt4DescriptorClass.factory()(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_INT4_CODEC_ID);
    });
    it('encodes and decodes number values verbatim', async () => {
      expect(await codec.encode(42, callCtx)).toBe(42);
      expect(await codec.decode(42, callCtx)).toBe(42);
    });
  });

  describe('pg/int2@1', () => {
    const codec = pgInt2DescriptorClass.factory()(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_INT2_CODEC_ID);
    });
    it('encodes and decodes number values verbatim', async () => {
      expect(await codec.encode(7, callCtx)).toBe(7);
      expect(await codec.decode(7, callCtx)).toBe(7);
    });
  });

  describe('pg/int8@1', () => {
    const codec = pgInt8DescriptorClass.factory()(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_INT8_CODEC_ID);
    });
    it('encodes and decodes number values verbatim', async () => {
      expect(await codec.encode(9_999_999_999, callCtx)).toBe(9_999_999_999);
      expect(await codec.decode(9_999_999_999, callCtx)).toBe(9_999_999_999);
    });
  });

  describe('pg/float4@1', () => {
    const codec = pgFloat4DescriptorClass.factory()(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_FLOAT4_CODEC_ID);
    });
    it('encodes and decodes number values verbatim', async () => {
      expect(await codec.encode(3.14, callCtx)).toBe(3.14);
      expect(await codec.decode(3.14, callCtx)).toBe(3.14);
    });
  });

  describe('pg/float8@1', () => {
    const codec = pgFloat8DescriptorClass.factory()(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_FLOAT8_CODEC_ID);
    });
    it('encodes and decodes number values verbatim', async () => {
      expect(await codec.encode(2.718281828, callCtx)).toBe(2.718281828);
      expect(await codec.decode(2.718281828, callCtx)).toBe(2.718281828);
    });
  });

  describe('pg/bool@1', () => {
    const codec = pgBoolDescriptorClass.factory()(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_BOOL_CODEC_ID);
    });
    it('encodes and decodes boolean values verbatim', async () => {
      expect(await codec.encode(true, callCtx)).toBe(true);
      expect(await codec.decode(false, callCtx)).toBe(false);
    });
  });

  describe('pg/numeric@1', () => {
    const codec = pgNumericDescriptorClass.factory({ precision: 10, scale: 2 })(instanceCtx);

    it('id proxies through the descriptor (independent of params)', () => {
      expect(codec.id).toBe(PG_NUMERIC_CODEC_ID);
    });

    it('encodes string verbatim', async () => {
      expect(await codec.encode('123.45', callCtx)).toBe('123.45');
    });

    it('decodes string verbatim and coerces number to string', async () => {
      expect(await codec.decode('123.45', callCtx)).toBe('123.45');
      expect(await codec.decode(123 as unknown as string, callCtx)).toBe('123');
    });

    it('renderOutputType returns Numeric<precision, scale>', () => {
      expect(pgNumericDescriptorClass.renderOutputType?.({ precision: 10, scale: 2 })).toBe(
        'Numeric<10, 2>',
      );
    });

    it('renderOutputType returns Numeric<precision> when scale absent', () => {
      expect(pgNumericDescriptorClass.renderOutputType?.({ precision: 10 })).toBe('Numeric<10>');
    });
  });

  describe('pg/timestamp@1', () => {
    const codec = pgTimestampDescriptorClass.factory({ precision: 3 })(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_TIMESTAMP_CODEC_ID);
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
      expect(pgTimestampDescriptorClass.renderOutputType?.({ precision: 3 })).toBe('Timestamp<3>');
    });

    it('renderOutputType returns bare Timestamp when precision absent', () => {
      expect(pgTimestampDescriptorClass.renderOutputType?.({})).toBe('Timestamp');
    });
  });

  describe('pg/timestamptz@1', () => {
    const codec = pgTimestamptzDescriptorClass.factory({ precision: 6 })(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_TIMESTAMPTZ_CODEC_ID);
    });

    it('round-trips Date values', async () => {
      const instant = new Date('2024-01-15T10:30:00Z');
      expect(await codec.encode(instant, callCtx)).toBe(instant);
      expect(await codec.decode(instant, callCtx)).toBe(instant);
    });

    it('round-trips through JSON via ISO 8601', () => {
      const instant = new Date('2024-01-15T10:30:00Z');
      expect(codec.encodeJson(instant)).toBe('2024-01-15T10:30:00.000Z');
      expect(codec.decodeJson('2024-01-15T10:30:00.000Z')).toEqual(instant);
    });

    it('throws on invalid JSON input with pg/timestamptz@1 label', () => {
      expect(() => codec.decodeJson(42)).toThrow(/pg\/timestamptz@1/);
    });
  });

  describe('pg/time@1', () => {
    const codec = pgTimeDescriptorClass.factory({ precision: 2 })(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_TIME_CODEC_ID);
    });
    it('round-trips strings verbatim', async () => {
      expect(await codec.encode('10:30:00', callCtx)).toBe('10:30:00');
      expect(await codec.decode('10:30:00', callCtx)).toBe('10:30:00');
    });
    it('renderOutputType formats Time<precision>', () => {
      expect(pgTimeDescriptorClass.renderOutputType?.({ precision: 2 })).toBe('Time<2>');
    });
  });

  describe('pg/timetz@1', () => {
    const codec = pgTimetzDescriptorClass.factory({})(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_TIMETZ_CODEC_ID);
    });
    it('round-trips strings verbatim', async () => {
      expect(await codec.encode('10:30:00+00', callCtx)).toBe('10:30:00+00');
      expect(await codec.decode('10:30:00+00', callCtx)).toBe('10:30:00+00');
    });
  });

  describe('pg/bit@1', () => {
    const codec = pgBitDescriptorClass.factory({ length: 8 })(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_BIT_CODEC_ID);
    });
    it('round-trips bit strings verbatim', async () => {
      expect(await codec.encode('10101010', callCtx)).toBe('10101010');
      expect(await codec.decode('10101010', callCtx)).toBe('10101010');
    });
    it('renderOutputType returns Bit<length>', () => {
      expect(pgBitDescriptorClass.renderOutputType?.({ length: 8 })).toBe('Bit<8>');
    });
    it('renderOutputType returns undefined when length absent', () => {
      expect(pgBitDescriptorClass.renderOutputType?.({})).toBeUndefined();
    });
  });

  describe('pg/varbit@1', () => {
    const codec = pgVarbitDescriptorClass.factory({ length: 16 })(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_VARBIT_CODEC_ID);
    });
    it('round-trips bit strings verbatim', async () => {
      expect(await codec.encode('1010', callCtx)).toBe('1010');
      expect(await codec.decode('1010', callCtx)).toBe('1010');
    });
    it('renderOutputType returns VarBit<length>', () => {
      expect(pgVarbitDescriptorClass.renderOutputType?.({ length: 16 })).toBe('VarBit<16>');
    });
  });

  describe('pg/interval@1', () => {
    const codec = pgIntervalDescriptorClass.factory({})(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_INTERVAL_CODEC_ID);
    });

    it('encodes string verbatim', async () => {
      expect(await codec.encode('1 day', callCtx)).toBe('1 day');
    });

    it('decodes string verbatim', async () => {
      expect(await codec.decode('1 day', callCtx)).toBe('1 day');
    });

    it('decodes object form to JSON string', async () => {
      expect(await codec.decode({ days: 1 } as unknown as string, callCtx)).toBe('{"days":1}');
    });
  });

  describe('pg/enum@1', () => {
    const codec = pgEnumDescriptorClass.factory({ values: ['red', 'green', 'blue'] })(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_ENUM_CODEC_ID);
    });

    it('round-trips string variants verbatim', async () => {
      expect(await codec.encode('red', callCtx)).toBe('red');
      expect(await codec.decode('green', callCtx)).toBe('green');
    });

    it("renderOutputType returns 'a' | 'b' | 'c' literal union", () => {
      expect(pgEnumDescriptorClass.renderOutputType?.({ values: ['red', 'green', 'blue'] })).toBe(
        "'red' | 'green' | 'blue'",
      );
    });
  });

  describe('pg/json@1', () => {
    const codec = pgJsonDescriptorClass.factory()(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_JSON_CODEC_ID);
    });

    it('encodes JsonValue to JSON string', async () => {
      expect(await codec.encode({ key: 'value' }, callCtx)).toBe('{"key":"value"}');
    });

    it('decodes JSON string to value', async () => {
      expect(await codec.decode('{"key":"value"}', callCtx)).toEqual({ key: 'value' });
    });

    it('decode passes through already-decoded values', async () => {
      expect(await codec.decode({ key: 'value' }, callCtx)).toEqual({ key: 'value' });
    });
  });

  describe('pg/jsonb@1', () => {
    const codec = pgJsonbDescriptorClass.factory()(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_JSONB_CODEC_ID);
    });

    it('encodes JsonValue to JSON string', async () => {
      expect(await codec.encode([1, 2, 3], callCtx)).toBe('[1,2,3]');
    });

    it('decodes JSON string to value', async () => {
      expect(await codec.decode('[1,2,3]', callCtx)).toEqual([1, 2, 3]);
    });

    it('decode passes through already-decoded values', async () => {
      expect(await codec.decode([1, 2, 3], callCtx)).toEqual([1, 2, 3]);
    });
  });

  describe('descriptor metadata', () => {
    it('codec ids match the PG_*_CODEC_ID constants', () => {
      expect(pgTextDescriptorClass.codecId).toBe(PG_TEXT_CODEC_ID);
      expect(pgInt4DescriptorClass.codecId).toBe(PG_INT4_CODEC_ID);
      expect(pgInt2DescriptorClass.codecId).toBe(PG_INT2_CODEC_ID);
      expect(pgInt8DescriptorClass.codecId).toBe(PG_INT8_CODEC_ID);
      expect(pgFloat4DescriptorClass.codecId).toBe(PG_FLOAT4_CODEC_ID);
      expect(pgFloat8DescriptorClass.codecId).toBe(PG_FLOAT8_CODEC_ID);
      expect(pgBoolDescriptorClass.codecId).toBe(PG_BOOL_CODEC_ID);
      expect(pgNumericDescriptorClass.codecId).toBe(PG_NUMERIC_CODEC_ID);
      expect(pgTimestampDescriptorClass.codecId).toBe(PG_TIMESTAMP_CODEC_ID);
      expect(pgTimestamptzDescriptorClass.codecId).toBe(PG_TIMESTAMPTZ_CODEC_ID);
      expect(pgTimeDescriptorClass.codecId).toBe(PG_TIME_CODEC_ID);
      expect(pgTimetzDescriptorClass.codecId).toBe(PG_TIMETZ_CODEC_ID);
      expect(pgBitDescriptorClass.codecId).toBe(PG_BIT_CODEC_ID);
      expect(pgVarbitDescriptorClass.codecId).toBe(PG_VARBIT_CODEC_ID);
      expect(pgIntervalDescriptorClass.codecId).toBe(PG_INTERVAL_CODEC_ID);
      expect(pgEnumDescriptorClass.codecId).toBe(PG_ENUM_CODEC_ID);
      expect(pgJsonDescriptorClass.codecId).toBe(PG_JSON_CODEC_ID);
      expect(pgJsonbDescriptorClass.codecId).toBe(PG_JSONB_CODEC_ID);
    });

    it('exposes nativeType meta keyed under db.sql.postgres', () => {
      expect(pgTextDescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe('text');
      expect(pgInt4DescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe('integer');
      expect(pgInt2DescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe('smallint');
      expect(pgInt8DescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe('bigint');
      expect(pgFloat4DescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe('real');
      expect(pgFloat8DescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe('double precision');
      expect(pgBoolDescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe('boolean');
      expect(pgNumericDescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe('numeric');
      expect(pgTimestampDescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe(
        'timestamp without time zone',
      );
      expect(pgTimestamptzDescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe(
        'timestamp with time zone',
      );
      expect(pgTimeDescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe('time');
      expect(pgTimetzDescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe('timetz');
      expect(pgBitDescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe('bit');
      expect(pgVarbitDescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe('bit varying');
      expect(pgIntervalDescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe('interval');
      expect(pgJsonDescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe('json');
      expect(pgJsonbDescriptorClass.meta?.db?.sql?.postgres?.nativeType).toBe('jsonb');
    });

    it('exposes traits and targetTypes for each codec', () => {
      expect(pgTextDescriptorClass.traits).toEqual(['equality', 'order', 'textual']);
      expect(pgInt4DescriptorClass.traits).toEqual(['equality', 'order', 'numeric']);
      expect(pgBoolDescriptorClass.traits).toEqual(['equality', 'boolean']);
      expect(pgJsonDescriptorClass.traits).toEqual([]);
      expect(pgJsonbDescriptorClass.traits).toEqual(['equality']);

      expect(pgTextDescriptorClass.targetTypes).toEqual(['text']);
      expect(pgNumericDescriptorClass.targetTypes).toEqual(['numeric', 'decimal']);
      expect(pgBitDescriptorClass.targetTypes).toEqual(['bit']);
      expect(pgVarbitDescriptorClass.targetTypes).toEqual(['bit varying']);
    });
  });
});
