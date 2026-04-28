import { describe, expect, it } from 'vitest';
import { codecDefinitions } from '../src/core/codecs';

describe('adapter-postgres codecs', () => {
  it('exports expected codec scalars', () => {
    expect(Object.keys(codecDefinitions).sort()).toEqual([
      'bit',
      'bit varying',
      'bool',
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
    const timestampCodec = codecDefinitions.timestamp.codec as {
      encode: (value: string | Date) => Promise<string>;
      decode: (wire: string | Date) => Promise<string>;
    };

    it('encodes Date to ISO string', async () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(await timestampCodec.encode(date)).toBe('2024-01-15T10:30:00.000Z');
    });

    it('decodes Date to ISO string', async () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(await timestampCodec.decode(date)).toBe('2024-01-15T10:30:00.000Z');
    });

    it('decodes string to string', async () => {
      const result = await timestampCodec.decode('2024-01-15T10:30:00.000Z');
      expect(result).toBe('2024-01-15T10:30:00.000Z');
    });

    it('encodes strings as-is', async () => {
      expect(await timestampCodec.encode('2024-01-15T10:30:00.000Z')).toBe(
        '2024-01-15T10:30:00.000Z',
      );
    });
  });

  describe('sql-timestamp codec', () => {
    const timestampCodec = codecDefinitions['sql-timestamp'].codec as {
      encode: (value: string | Date) => Promise<string>;
      decode: (wire: string | Date) => Promise<string>;
    };

    it('encodes Date values to ISO strings', async () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(await timestampCodec.encode(date)).toBe('2024-01-15T10:30:00.000Z');
    });

    it('keeps string values stable', async () => {
      const wire = '2024-01-15T10:30:00.000Z';
      expect(await timestampCodec.encode(wire)).toBe(wire);
      expect(await timestampCodec.decode(wire)).toBe(wire);
    });
  });

  describe('timestamptz codec', () => {
    const timestamptzCodec = codecDefinitions.timestamptz.codec as {
      encode: (value: string | Date) => Promise<string>;
      decode: (wire: string | Date) => Promise<string>;
    };

    it('encodes Date values to ISO strings', async () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(await timestamptzCodec.encode(date)).toBe('2024-01-15T10:30:00.000Z');
    });

    it('keeps strings and already-decoded values stable', async () => {
      const wire = '2024-01-15T10:30:00.000Z';
      expect(await timestamptzCodec.encode(wire)).toBe(wire);
      expect(await timestamptzCodec.decode(wire)).toBe(wire);
    });
  });

  describe('json codec', () => {
    const jsonCodec = codecDefinitions.json.codec as {
      encode: (value: unknown) => Promise<string>;
      decode: (wire: string | unknown) => Promise<unknown>;
    };

    it('encodes object to JSON string', async () => {
      expect(await jsonCodec.encode({ key: 'value', nested: { ok: true } })).toBe(
        '{"key":"value","nested":{"ok":true}}',
      );
    });

    it('decodes JSON string to object', async () => {
      expect(await jsonCodec.decode('{"key":"value"}')).toEqual({ key: 'value' });
    });

    it('passes through already-decoded values', async () => {
      expect(await jsonCodec.decode({ key: 'value' })).toEqual({ key: 'value' });
    });
  });

  describe('jsonb codec', () => {
    const jsonbCodec = codecDefinitions.jsonb.codec as {
      encode: (value: unknown) => Promise<string>;
      decode: (wire: string | unknown) => Promise<unknown>;
    };

    it('encodes arrays and null values', async () => {
      expect(await jsonbCodec.encode([1, null, { active: false }])).toBe(
        '[1,null,{"active":false}]',
      );
    });

    it('decodes JSON string to array', async () => {
      expect(await jsonbCodec.decode('[1,true,{"x":1}]')).toEqual([1, true, { x: 1 }]);
    });

    it('passes through already-decoded values', async () => {
      expect(await jsonbCodec.decode({ key: 'value' })).toEqual({ key: 'value' });
    });
  });

  describe('scalar passthrough codecs', () => {
    it.each([
      { scalar: 'sql-text', value: 'portable text' },
      { scalar: 'text', value: 'hello world' },
      { scalar: 'enum', value: 'ADMIN' },
    ] as const)('keeps $scalar values unchanged', async ({ scalar, value }) => {
      const codec = codecDefinitions[scalar].codec as {
        encode: (input: string) => Promise<string>;
        decode: (input: string) => Promise<string>;
      };
      expect(await codec.encode(value)).toBe(value);
      expect(await codec.decode(value)).toBe(value);
    });

    it.each([
      { scalar: 'int2', value: 12 },
      { scalar: 'int4', value: 42 },
      { scalar: 'int8', value: 9001 },
      { scalar: 'float4', value: 3.14 },
      { scalar: 'float8', value: Math.E },
    ] as const)('keeps $scalar values unchanged', async ({ scalar, value }) => {
      const codec = codecDefinitions[scalar].codec as {
        encode: (input: number) => Promise<number>;
        decode: (input: number) => Promise<number>;
      };
      expect(await codec.encode(value)).toBe(value);
      expect(await codec.decode(value)).toBe(value);
    });

    it('keeps boolean values unchanged', async () => {
      const boolCodec = codecDefinitions.bool.codec as {
        encode: (input: boolean) => Promise<boolean>;
        decode: (input: boolean) => Promise<boolean>;
      };
      expect(await boolCodec.encode(true)).toBe(true);
      expect(await boolCodec.decode(false)).toBe(false);
    });
  });

  describe('character codec', () => {
    const charCodec = codecDefinitions.character.codec as {
      encode: (value: string) => Promise<string>;
      decode: (wire: string) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = 'A';
      const encoded = await charCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', async () => {
      const value = 'Z';
      const decoded = await charCodec.decode(value);
      expect(decoded).toBe(value);
    });
  });

  describe('character varying codec', () => {
    const varcharCodec = codecDefinitions['character varying'].codec as {
      encode: (value: string) => Promise<string>;
      decode: (wire: string) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = 'hello';
      const encoded = await varcharCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', async () => {
      const value = 'world';
      const decoded = await varcharCodec.decode(value);
      expect(decoded).toBe(value);
    });
  });

  describe('numeric codec', () => {
    const numericCodec = codecDefinitions.numeric.codec as {
      encode: (value: string) => Promise<string>;
      decode: (wire: string | number) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = '123.45';
      const encoded = await numericCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes number to string', async () => {
      const decoded = await numericCodec.decode(42);
      expect(decoded).toBe('42');
    });
  });

  describe('time codec', () => {
    const timeCodec = codecDefinitions.time.codec as {
      encode: (value: string) => Promise<string>;
      decode: (wire: string) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = '12:34:56';
      const encoded = await timeCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', async () => {
      const value = '23:59:59';
      const decoded = await timeCodec.decode(value);
      expect(decoded).toBe(value);
    });
  });

  describe('timetz codec', () => {
    const timetzCodec = codecDefinitions.timetz.codec as {
      encode: (value: string) => Promise<string>;
      decode: (wire: string) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = '12:34:56+02';
      const encoded = await timetzCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', async () => {
      const value = '23:59:59-05';
      const decoded = await timetzCodec.decode(value);
      expect(decoded).toBe(value);
    });
  });

  describe('bit codec', () => {
    const bitCodec = codecDefinitions.bit.codec as {
      encode: (value: string) => Promise<string>;
      decode: (wire: string) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = '1010';
      const encoded = await bitCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', async () => {
      const value = '0101';
      const decoded = await bitCodec.decode(value);
      expect(decoded).toBe(value);
    });
  });

  describe('bit varying codec', () => {
    const varbitCodec = codecDefinitions['bit varying'].codec as {
      encode: (value: string) => Promise<string>;
      decode: (wire: string) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = '11110000';
      const encoded = await varbitCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', async () => {
      const value = '00001111';
      const decoded = await varbitCodec.decode(value);
      expect(decoded).toBe(value);
    });
  });

  describe('interval codec', () => {
    const intervalCodec = codecDefinitions.interval.codec as {
      encode: (value: string) => Promise<string>;
      decode: (wire: string | Record<string, unknown>) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      const value = '1 day';
      const encoded = await intervalCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', async () => {
      const value = '2 hours';
      const decoded = await intervalCodec.decode(value);
      expect(decoded).toBe(value);
    });

    it('serializes object wire values to JSON strings', async () => {
      const decoded = await intervalCodec.decode({ hours: 2, minutes: 30 });
      expect(decoded).toBe('{"hours":2,"minutes":30}');
    });
  });

  describe('metadata and params schema', () => {
    const postgresNativeTypeCases: ReadonlyArray<{
      scalar: keyof typeof codecDefinitions;
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
      const codec = codecDefinitions[scalar].codec as {
        meta?: { db?: { sql?: { postgres?: { nativeType?: string } } } };
      };
      expect(codec.meta?.db?.sql?.postgres?.nativeType).toBe(nativeType);
    });

    const paramsSchemaPresenceCases: ReadonlyArray<{
      scalar: keyof typeof codecDefinitions;
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

    it.each(paramsSchemaPresenceCases)('tracks params schema presence for $scalar', ({
      scalar,
      hasParamsSchema,
    }) => {
      const codec = codecDefinitions[scalar].codec as {
        paramsSchema?: unknown;
      };
      expect(codec.paramsSchema !== undefined).toBe(hasParamsSchema);
    });

    const initHookCases: ReadonlyArray<{
      scalar: keyof typeof codecDefinitions;
      hasInit: boolean;
      expected: { kind: 'fixed' | 'variable'; maxLength: number } | undefined;
    }> = [
      { scalar: 'character', hasInit: true, expected: { kind: 'fixed', maxLength: 12 } },
      { scalar: 'character varying', hasInit: true, expected: { kind: 'variable', maxLength: 64 } },
      { scalar: 'numeric', hasInit: false, expected: undefined },
    ];

    it.each(initHookCases)('tracks init hook presence for $scalar', ({
      scalar,
      hasInit,
      expected,
    }) => {
      const codec = codecDefinitions[scalar].codec as {
        init?: (params: { length: number }) => unknown;
      };
      expect(codec.init !== undefined).toBe(hasInit);
      if (expected) {
        expect(codec.init?.({ length: expected.maxLength })).toEqual(expected);
      }
    });
  });

  describe('encodeJson / decodeJson', () => {
    describe('pg/timestamptz@1', () => {
      const codec = codecDefinitions.timestamptz.codec;

      it('encodes Date to ISO string', () => {
        expect(codec.encodeJson(new Date('2024-01-15T00:00:00.000Z'))).toBe(
          '2024-01-15T00:00:00.000Z',
        );
      });

      it('encodes string as-is', () => {
        expect(codec.encodeJson('2024-01-15T00:00:00.000Z')).toBe('2024-01-15T00:00:00.000Z');
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
      const codec = codecDefinitions.timestamp.codec;

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
        const codec = codecDefinitions.int4.codec;
        expect(codec.encodeJson(42)).toBe(42);
        expect(codec.decodeJson(42)).toBe(42);
      });

      it('pg/text@1 round-trips strings', () => {
        const codec = codecDefinitions.text.codec;
        expect(codec.encodeJson('hello')).toBe('hello');
        expect(codec.decodeJson('hello')).toBe('hello');
      });

      it('pg/bool@1 round-trips booleans', () => {
        const codec = codecDefinitions.bool.codec;
        expect(codec.encodeJson(true)).toBe(true);
        expect(codec.decodeJson(false)).toBe(false);
      });

      it('pg/int8@1 round-trips numbers (identity)', () => {
        const codec = codecDefinitions.int8.codec;
        expect(codec.encodeJson(9001)).toBe(9001);
        expect(codec.decodeJson(9001)).toBe(9001);
      });
    });
  });

  describe('numeric codec decode', () => {
    const numericCodec = codecDefinitions.numeric.codec as {
      decode: (wire: string | number) => Promise<string>;
    };

    it.each([
      { wire: 42, expected: '42' },
      { wire: '123.45', expected: '123.45' },
    ])('decodes $wire to $expected', async ({ wire, expected }) => {
      expect(await numericCodec.decode(wire)).toBe(expected);
    });
  });
});
