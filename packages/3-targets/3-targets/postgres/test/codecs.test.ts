import type { SqlCodecCallContext } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { byScalar, codecDescriptorDefinitions } from '../src/core/codecs';

describe('adapter-postgres codecs', () => {
  it('exports expected codec scalars', () => {
    expect(Object.keys(byScalar).sort()).toEqual([
      'bit',
      'bit varying',
      'bool',
      'bytea',
      'char',
      'character',
      'character varying',
      'double precision',
      'enum',
      'float',
      'float4',
      'float8',
      'int',
      'int2',
      'int4',
      'int8',
      'integer',
      'interval',
      'json',
      'jsonb',
      'numeric',
      'sql-text',
      'sql-timestamp',
      'text',
      'time',
      'timestamp',
      'timestamptz',
      'timetz',
      'varchar',
    ]);
  });

  describe('timestamp codec', () => {
    const timestampCodec = byScalar.timestamp.codec as {
      encode: (value: Date, ctx: SqlCodecCallContext) => Promise<Date>;
      decode: (wire: Date, ctx: SqlCodecCallContext) => Promise<Date>;
    };

    it('encodes Date values as-is', async () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(await timestampCodec.encode(date, {})).toBe(date);
    });

    it('decodes Date values as-is', async () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(await timestampCodec.decode(date, {})).toBe(date);
    });
  });

  describe('sql-timestamp codec', () => {
    const timestampCodec = byScalar['sql-timestamp'].codec as {
      encode: (value: Date, ctx: SqlCodecCallContext) => Promise<Date>;
      decode: (wire: Date, ctx: SqlCodecCallContext) => Promise<Date>;
    };

    it('round-trips Date values', async () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(await timestampCodec.encode(date, {})).toBe(date);
      expect(await timestampCodec.decode(date, {})).toBe(date);
    });
  });

  describe('timestamptz codec', () => {
    const timestamptzCodec = byScalar.timestamptz.codec as {
      encode: (value: Date, ctx: SqlCodecCallContext) => Promise<Date>;
      decode: (wire: Date, ctx: SqlCodecCallContext) => Promise<Date>;
    };

    it('round-trips Date values', async () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(await timestamptzCodec.encode(date, {})).toBe(date);
      expect(await timestamptzCodec.decode(date, {})).toBe(date);
    });
  });

  describe('json codec', () => {
    const jsonCodec = byScalar.json.codec as {
      encode: (value: unknown, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string | unknown, ctx: SqlCodecCallContext) => Promise<unknown>;
    };

    it('encodes object to JSON string', async () => {
      expect(await jsonCodec.encode({ key: 'value', nested: { ok: true } }, {})).toBe(
        '{"key":"value","nested":{"ok":true}}',
      );
    });

    it('decodes JSON string to object', async () => {
      expect(await jsonCodec.decode('{"key":"value"}', {})).toEqual({ key: 'value' });
    });

    it('passes through already-decoded values', async () => {
      expect(await jsonCodec.decode({ key: 'value' }, {})).toEqual({ key: 'value' });
    });
  });

  describe('jsonb codec', () => {
    const jsonbCodec = byScalar.jsonb.codec as {
      encode: (value: unknown, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string | unknown, ctx: SqlCodecCallContext) => Promise<unknown>;
    };

    it('encodes arrays and null values', async () => {
      expect(await jsonbCodec.encode([1, null, { active: false }], {})).toBe(
        '[1,null,{"active":false}]',
      );
    });

    it('decodes JSON string to array', async () => {
      expect(await jsonbCodec.decode('[1,true,{"x":1}]', {})).toEqual([1, true, { x: 1 }]);
    });

    it('passes through already-decoded values', async () => {
      expect(await jsonbCodec.decode({ key: 'value' }, {})).toEqual({ key: 'value' });
    });
  });

  describe('scalar passthrough codecs', () => {
    it.each([
      { scalar: 'sql-text', value: 'portable text' },
      { scalar: 'text', value: 'hello world' },
      { scalar: 'enum', value: 'ADMIN' },
    ] as const)('keeps $scalar values unchanged', async ({ scalar, value }) => {
      const codec = byScalar[scalar].codec as {
        encode: (input: string, ctx: SqlCodecCallContext) => Promise<string>;
        decode: (input: string, ctx: SqlCodecCallContext) => Promise<string>;
      };
      expect(await codec.encode(value, {})).toBe(value);
      expect(await codec.decode(value, {})).toBe(value);
    });

    it.each([
      { scalar: 'int2', value: 12 },
      { scalar: 'int4', value: 42 },
      { scalar: 'int8', value: 9001 },
      { scalar: 'float4', value: 3.14 },
      { scalar: 'float8', value: Math.E },
    ] as const)('keeps $scalar values unchanged', async ({ scalar, value }) => {
      const codec = byScalar[scalar].codec as {
        encode: (input: number, ctx: SqlCodecCallContext) => Promise<number>;
        decode: (input: number, ctx: SqlCodecCallContext) => Promise<number>;
      };
      expect(await codec.encode(value, {})).toBe(value);
      expect(await codec.decode(value, {})).toBe(value);
    });

    it('keeps boolean values unchanged', async () => {
      const boolCodec = byScalar.bool.codec as {
        encode: (input: boolean, ctx: SqlCodecCallContext) => Promise<boolean>;
        decode: (input: boolean, ctx: SqlCodecCallContext) => Promise<boolean>;
      };
      expect(await boolCodec.encode(true, {})).toBe(true);
      expect(await boolCodec.decode(false, {})).toBe(false);
    });
  });

  describe('character codec', () => {
    const charCodec = byScalar.character.codec as {
      encode: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = 'A';
      const encoded = await charCodec.encode(value, {});
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', async () => {
      const value = 'Z';
      const decoded = await charCodec.decode(value, {});
      expect(decoded).toBe(value);
    });
  });

  describe('character varying codec', () => {
    const varcharCodec = byScalar['character varying'].codec as {
      encode: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = 'hello';
      const encoded = await varcharCodec.encode(value, {});
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', async () => {
      const value = 'world';
      const decoded = await varcharCodec.decode(value, {});
      expect(decoded).toBe(value);
    });
  });

  describe('numeric codec', () => {
    const numericCodec = byScalar.numeric.codec as {
      encode: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string | number, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = '123.45';
      const encoded = await numericCodec.encode(value, {});
      expect(encoded).toBe(value);
    });

    it('decodes number to string', async () => {
      const decoded = await numericCodec.decode(42, {});
      expect(decoded).toBe('42');
    });
  });

  describe('time codec', () => {
    const timeCodec = byScalar.time.codec as {
      encode: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = '12:34:56';
      const encoded = await timeCodec.encode(value, {});
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', async () => {
      const value = '23:59:59';
      const decoded = await timeCodec.decode(value, {});
      expect(decoded).toBe(value);
    });
  });

  describe('timetz codec', () => {
    const timetzCodec = byScalar.timetz.codec as {
      encode: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = '12:34:56+02';
      const encoded = await timetzCodec.encode(value, {});
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', async () => {
      const value = '23:59:59-05';
      const decoded = await timetzCodec.decode(value, {});
      expect(decoded).toBe(value);
    });
  });

  describe('bit codec', () => {
    const bitCodec = byScalar.bit.codec as {
      encode: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = '1010';
      const encoded = await bitCodec.encode(value, {});
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', async () => {
      const value = '0101';
      const decoded = await bitCodec.decode(value, {});
      expect(decoded).toBe(value);
    });
  });

  describe('bit varying codec', () => {
    const varbitCodec = byScalar['bit varying'].codec as {
      encode: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = '11110000';
      const encoded = await varbitCodec.encode(value, {});
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', async () => {
      const value = '00001111';
      const decoded = await varbitCodec.decode(value, {});
      expect(decoded).toBe(value);
    });
  });

  describe('bytea codec', () => {
    const byteaCodec = codecDefinitions.bytea.codec as {
      encode: (value: Uint8Array, ctx: SqlCodecCallContext) => Promise<Uint8Array>;
      decode: (wire: Uint8Array, ctx: SqlCodecCallContext) => Promise<Uint8Array>;
      encodeJson: (value: Uint8Array) => unknown;
      decodeJson: (json: unknown) => Uint8Array;
    };

    it('round-trips a small payload', async () => {
      const input = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const encoded = await byteaCodec.encode(input, {});
      const decoded = await byteaCodec.decode(encoded, {});
      expect(decoded).toEqual(input);
    });

    it('round-trips an empty payload', async () => {
      const input = new Uint8Array(0);
      const encoded = await byteaCodec.encode(input, {});
      const decoded = await byteaCodec.decode(encoded, {});
      expect(decoded).toEqual(input);
      expect(decoded.byteLength).toBe(0);
    });

    it('normalizes Buffer wire values to a plain Uint8Array view', async () => {
      const buffer = Buffer.from([0x01, 0x02, 0x03]);
      const decoded = await byteaCodec.decode(buffer, {});
      expect(decoded).toBeInstanceOf(Uint8Array);
      expect(decoded.constructor).toBe(Uint8Array);
      expect(Array.from(decoded)).toEqual([0x01, 0x02, 0x03]);
    });

    it('encodes Uint8Array to base64 in JSON form', () => {
      const input = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
      expect(byteaCodec.encodeJson(input)).toBe('aGVsbG8=');
    });

    it('decodes base64 string back to Uint8Array in JSON form', () => {
      const decoded = byteaCodec.decodeJson('aGVsbG8=');
      expect(decoded).toBeInstanceOf(Uint8Array);
      expect(Array.from(decoded)).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
    });

    it('round-trips through encodeJson / decodeJson', () => {
      const input = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const json = byteaCodec.encodeJson(input);
      const decoded = byteaCodec.decodeJson(json);
      expect(Array.from(decoded)).toEqual(Array.from(input));
    });

    it('throws on non-string input to decodeJson', () => {
      expect(() => byteaCodec.decodeJson(42)).toThrow('Expected base64 string for pg/bytea@1');
    });

    it('throws on invalid base64 characters in decodeJson', () => {
      // The bytea codec must reject malformed base64 rather than silently
      // skipping invalid characters and producing arbitrary bytes — see
      // https://github.com/prisma/prisma-next/pull/428.
      expect(() => byteaCodec.decodeJson('!!!not base64!!!')).toThrow(
        /Invalid base64 string for pg\/bytea@1/,
      );
    });

    it('throws on base64 with stray whitespace in decodeJson', () => {
      // Whitespace decodes to valid bytes via Buffer.from, but the round-trip
      // comparison rejects non-canonical input.
      expect(() => byteaCodec.decodeJson('SGVs bG8=')).toThrow(
        /Invalid base64 string for pg\/bytea@1/,
      );
    });
  });

  describe('interval codec', () => {
    const intervalCodec = byScalar.interval.codec as {
      encode: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string | Record<string, unknown>, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = '1 day';
      const encoded = await intervalCodec.encode(value, {});
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', async () => {
      const value = '2 hours';
      const decoded = await intervalCodec.decode(value, {});
      expect(decoded).toBe(value);
    });

    it('serializes object wire values to JSON strings', async () => {
      const decoded = await intervalCodec.decode({ hours: 2, minutes: 30 }, {});
      expect(decoded).toBe('{"hours":2,"minutes":30}');
    });
  });

  describe('metadata and params schema', () => {
    const postgresNativeTypeCases: ReadonlyArray<{
      scalar: keyof typeof byScalar;
      nativeType: string;
    }> = [
      { scalar: 'character', nativeType: 'character' },
      { scalar: 'character varying', nativeType: 'character varying' },
      { scalar: 'integer', nativeType: 'integer' },
      { scalar: 'double precision', nativeType: 'double precision' },
      { scalar: 'int4', nativeType: 'integer' },
      { scalar: 'float8', nativeType: 'double precision' },
      { scalar: 'bit varying', nativeType: 'bit varying' },
    ];

    it.each(postgresNativeTypeCases)('sets postgres nativeType metadata for $scalar', ({
      scalar,
      nativeType,
    }) => {
      const meta = codecDescriptorDefinitions[scalar].descriptor.meta as
        | { db?: { sql?: { postgres?: { nativeType?: string } } } }
        | undefined;
      expect(meta?.db?.sql?.postgres?.nativeType).toBe(nativeType);
    });

    const paramsSchemaPresenceCases: ReadonlyArray<{
      scalar: keyof typeof byScalar;
      hasParamsSchema: boolean;
    }> = [
      { scalar: 'character', hasParamsSchema: true },
      { scalar: 'character varying', hasParamsSchema: true },
      { scalar: 'numeric', hasParamsSchema: true },
      { scalar: 'sql-timestamp', hasParamsSchema: true },
      { scalar: 'timestamp', hasParamsSchema: true },
      { scalar: 'timestamptz', hasParamsSchema: true },
      { scalar: 'time', hasParamsSchema: true },
      { scalar: 'timetz', hasParamsSchema: true },
      { scalar: 'bit', hasParamsSchema: true },
      { scalar: 'bit varying', hasParamsSchema: true },
      { scalar: 'interval', hasParamsSchema: true },
      { scalar: 'sql-text', hasParamsSchema: false },
      { scalar: 'text', hasParamsSchema: false },
      { scalar: 'enum', hasParamsSchema: false },
      { scalar: 'bool', hasParamsSchema: false },
      { scalar: 'int4', hasParamsSchema: false },
    ];

    it.each(
      paramsSchemaPresenceCases,
    )('tracks params schema presence for $scalar (descriptor side)', ({
      scalar,
      hasParamsSchema: _hasParamsSchema,
    }) => {
      // Descriptors always carry `paramsSchema` (every codec has one,
      // be it `voidParamsSchema` for non-parameterized codecs or a
      // codec-specific schema). The legacy `mkCodec()` factory's
      // optional `paramsSchema` slot retired with the SQL `Codec`
      // narrow (TML-2357 M2 Phase B); descriptor-side coverage is
      // exercised here so the parameterization split remains
      // observable through the descriptor surface.
      const definition = codecDescriptorDefinitions[scalar];
      expect(definition.descriptor.paramsSchema).toBeDefined();
    });

    // The legacy `init` hook on the codec instance retired with the
    // SQL `Codec` narrow (TML-2357 M2 Phase B). Per-instance state for
    // parameterized codecs now flows through the `CodecDescriptor`'s
    // `factory(params)(ctx)` close-over.
  });

  describe('encodeJson / decodeJson', () => {
    describe('pg/timestamptz@1', () => {
      const codec = byScalar.timestamptz.codec;

      it('encodes Date to ISO string', () => {
        expect(codec.encodeJson(new Date('2024-01-15T00:00:00.000Z'))).toBe(
          '2024-01-15T00:00:00.000Z',
        );
      });

      it('decodes ISO string to Date', () => {
        const result = codec.decodeJson('2024-01-15T00:00:00.000Z');
        expect(result).toBeInstanceOf(Date);
        expect(result).toEqual(new Date('2024-01-15T00:00:00.000Z'));
      });

      it('round-trips Date values', () => {
        const original = new Date('2024-06-15T14:30:00.000Z');
        const encoded = codec.encodeJson(original);
        const decoded = codec.decodeJson(encoded);
        expect(decoded).toEqual(original);
      });

      it('throws on non-string input to decodeJson', () => {
        expect(() => codec.decodeJson(42)).toThrow('Expected ISO date string for pg/timestamptz@1');
      });

      it('throws on malformed date string in decodeJson', () => {
        expect(() => codec.decodeJson('not-a-date')).toThrow(
          'Invalid ISO date string for pg/timestamptz@1',
        );
      });
    });

    describe('pg/timestamp@1', () => {
      const codec = byScalar.timestamp.codec;

      it('encodes Date to ISO string', () => {
        expect(codec.encodeJson(new Date('2024-01-15T00:00:00.000Z'))).toBe(
          '2024-01-15T00:00:00.000Z',
        );
      });

      it('decodes ISO string to Date', () => {
        const result = codec.decodeJson('2024-01-15T00:00:00.000Z');
        expect(result).toBeInstanceOf(Date);
        expect(result).toEqual(new Date('2024-01-15T00:00:00.000Z'));
      });

      it('throws on non-string input to decodeJson', () => {
        expect(() => codec.decodeJson(42)).toThrow('Expected ISO date string for pg/timestamp@1');
      });

      it('throws on malformed date string in decodeJson', () => {
        expect(() => codec.decodeJson('garbage')).toThrow(
          'Invalid ISO date string for pg/timestamp@1',
        );
      });
    });

    describe('identity codecs', () => {
      it('pg/int4@1 round-trips numbers', () => {
        const codec = byScalar.int4.codec;
        expect(codec.encodeJson(42)).toBe(42);
        expect(codec.decodeJson(42)).toBe(42);
      });

      it('pg/text@1 round-trips strings', () => {
        const codec = byScalar.text.codec;
        expect(codec.encodeJson('hello')).toBe('hello');
        expect(codec.decodeJson('hello')).toBe('hello');
      });

      it('pg/bool@1 round-trips booleans', () => {
        const codec = byScalar.bool.codec;
        expect(codec.encodeJson(true)).toBe(true);
        expect(codec.decodeJson(false)).toBe(false);
      });

      it('pg/int8@1 round-trips numbers (identity)', () => {
        const codec = byScalar.int8.codec;
        expect(codec.encodeJson(9001)).toBe(9001);
        expect(codec.decodeJson(9001)).toBe(9001);
      });
    });
  });

  describe('numeric codec decode', () => {
    const numericCodec = byScalar.numeric.codec as {
      decode: (wire: string | number, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it.each([
      { wire: 42, expected: '42' },
      { wire: '123.45', expected: '123.45' },
    ])('decodes $wire to $expected', async ({ wire, expected }) => {
      expect(await numericCodec.decode(wire, {})).toBe(expected);
    });
  });
});
