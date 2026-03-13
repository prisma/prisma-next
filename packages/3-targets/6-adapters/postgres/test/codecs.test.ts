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
      encode: (value: string | Date) => string;
      decode: (wire: string | Date) => string;
    };

    it('encodes Date to ISO string', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(timestampCodec.encode(date)).toBe('2024-01-15T10:30:00.000Z');
    });

    it('decodes Date to ISO string', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(timestampCodec.decode(date)).toBe('2024-01-15T10:30:00.000Z');
    });

    it('decodes string to string', () => {
      const result = timestampCodec.decode('2024-01-15T10:30:00.000Z');
      expect(result).toBe('2024-01-15T10:30:00.000Z');
    });

    it('encodes strings as-is', () => {
      expect(timestampCodec.encode('2024-01-15T10:30:00.000Z')).toBe('2024-01-15T10:30:00.000Z');
    });
  });

  describe('timestamptz codec', () => {
    const timestamptzCodec = codecDefinitions.timestamptz.codec as {
      encode: (value: string | Date) => string;
      decode: (wire: string | Date) => string;
    };

    it('encodes Date values to ISO strings', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(timestamptzCodec.encode(date)).toBe('2024-01-15T10:30:00.000Z');
    });

    it('keeps strings and already-decoded values stable', () => {
      const wire = '2024-01-15T10:30:00.000Z';
      expect(timestamptzCodec.encode(wire)).toBe(wire);
      expect(timestamptzCodec.decode(wire)).toBe(wire);
    });
  });

  describe('json codec', () => {
    const jsonCodec = codecDefinitions.json.codec as {
      encode: (value: unknown) => string;
      decode: (wire: string | unknown) => unknown;
    };

    it('encodes object to JSON string', () => {
      expect(jsonCodec.encode({ key: 'value', nested: { ok: true } })).toBe(
        '{"key":"value","nested":{"ok":true}}',
      );
    });

    it('decodes JSON string to object', () => {
      expect(jsonCodec.decode('{"key":"value"}')).toEqual({ key: 'value' });
    });

    it('passes through already-decoded values', () => {
      expect(jsonCodec.decode({ key: 'value' })).toEqual({ key: 'value' });
    });
  });

  describe('jsonb codec', () => {
    const jsonbCodec = codecDefinitions.jsonb.codec as {
      encode: (value: unknown) => string;
      decode: (wire: string | unknown) => unknown;
    };

    it('encodes arrays and null values', () => {
      expect(jsonbCodec.encode([1, null, { active: false }])).toBe('[1,null,{"active":false}]');
    });

    it('decodes JSON string to array', () => {
      expect(jsonbCodec.decode('[1,true,{"x":1}]')).toEqual([1, true, { x: 1 }]);
    });

    it('passes through already-decoded values', () => {
      expect(jsonbCodec.decode({ key: 'value' })).toEqual({ key: 'value' });
    });
  });

  describe('scalar passthrough codecs', () => {
    it.each([
      { scalar: 'text', value: 'hello world' },
      { scalar: 'enum', value: 'ADMIN' },
    ] as const)('keeps $scalar values unchanged', ({ scalar, value }) => {
      const codec = codecDefinitions[scalar].codec as {
        encode: (input: string) => string;
        decode: (input: string) => string;
      };
      expect(codec.encode(value)).toBe(value);
      expect(codec.decode(value)).toBe(value);
    });

    it.each([
      { scalar: 'int2', value: 12 },
      { scalar: 'int4', value: 42 },
      { scalar: 'int8', value: 9001 },
      { scalar: 'float4', value: 3.14 },
      { scalar: 'float8', value: Math.E },
    ] as const)('keeps $scalar values unchanged', ({ scalar, value }) => {
      const codec = codecDefinitions[scalar].codec as {
        encode: (input: number) => number;
        decode: (input: number) => number;
      };
      expect(codec.encode(value)).toBe(value);
      expect(codec.decode(value)).toBe(value);
    });

    it('keeps boolean values unchanged', () => {
      const boolCodec = codecDefinitions.bool.codec as {
        encode: (input: boolean) => boolean;
        decode: (input: boolean) => boolean;
      };
      expect(boolCodec.encode(true)).toBe(true);
      expect(boolCodec.decode(false)).toBe(false);
    });
  });

  describe('character codec', () => {
    const charCodec = codecDefinitions.character.codec as {
      encode: (value: string) => string;
      decode: (wire: string) => string;
    };

    it('encodes string as-is', () => {
      const value = 'A';
      const encoded = charCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', () => {
      const value = 'Z';
      const decoded = charCodec.decode(value);
      expect(decoded).toBe(value);
    });
  });

  describe('character varying codec', () => {
    const varcharCodec = codecDefinitions['character varying'].codec as {
      encode: (value: string) => string;
      decode: (wire: string) => string;
    };

    it('encodes string as-is', () => {
      const value = 'hello';
      const encoded = varcharCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', () => {
      const value = 'world';
      const decoded = varcharCodec.decode(value);
      expect(decoded).toBe(value);
    });
  });

  describe('numeric codec', () => {
    const numericCodec = codecDefinitions.numeric.codec as {
      encode: (value: string) => string;
      decode: (wire: string | number) => string;
    };

    it('encodes string as-is', () => {
      const value = '123.45';
      const encoded = numericCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes number to string', () => {
      const decoded = numericCodec.decode(42);
      expect(decoded).toBe('42');
    });
  });

  describe('time codec', () => {
    const timeCodec = codecDefinitions.time.codec as {
      encode: (value: string) => string;
      decode: (wire: string) => string;
    };

    it('encodes string as-is', () => {
      const value = '12:34:56';
      const encoded = timeCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', () => {
      const value = '23:59:59';
      const decoded = timeCodec.decode(value);
      expect(decoded).toBe(value);
    });
  });

  describe('timetz codec', () => {
    const timetzCodec = codecDefinitions.timetz.codec as {
      encode: (value: string) => string;
      decode: (wire: string) => string;
    };

    it('encodes string as-is', () => {
      const value = '12:34:56+02';
      const encoded = timetzCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', () => {
      const value = '23:59:59-05';
      const decoded = timetzCodec.decode(value);
      expect(decoded).toBe(value);
    });
  });

  describe('bit codec', () => {
    const bitCodec = codecDefinitions.bit.codec as {
      encode: (value: string) => string;
      decode: (wire: string) => string;
    };

    it('encodes string as-is', () => {
      const value = '1010';
      const encoded = bitCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', () => {
      const value = '0101';
      const decoded = bitCodec.decode(value);
      expect(decoded).toBe(value);
    });
  });

  describe('bit varying codec', () => {
    const varbitCodec = codecDefinitions['bit varying'].codec as {
      encode: (value: string) => string;
      decode: (wire: string) => string;
    };

    it('encodes string as-is', () => {
      const value = '11110000';
      const encoded = varbitCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', () => {
      const value = '00001111';
      const decoded = varbitCodec.decode(value);
      expect(decoded).toBe(value);
    });
  });

  describe('interval codec', () => {
    const intervalCodec = codecDefinitions.interval.codec as {
      encode: (value: string) => string;
      decode: (wire: string | Record<string, unknown>) => string;
    };

    it('encodes string as-is', () => {
      const value = '1 day';
      const encoded = intervalCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', () => {
      const value = '2 hours';
      const decoded = intervalCodec.decode(value);
      expect(decoded).toBe(value);
    });

    it('serializes object wire values to JSON strings', () => {
      const decoded = intervalCodec.decode({ hours: 2, minutes: 30 });
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
      { scalar: 'timestamp', hasParamsSchema: true },
      { scalar: 'timestamptz', hasParamsSchema: true },
      { scalar: 'time', hasParamsSchema: true },
      { scalar: 'timetz', hasParamsSchema: true },
      { scalar: 'bit', hasParamsSchema: true },
      { scalar: 'bit varying', hasParamsSchema: true },
      { scalar: 'interval', hasParamsSchema: true },
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

  describe('numeric codec decode', () => {
    const numericCodec = codecDefinitions.numeric.codec as {
      decode: (wire: string | number) => string;
    };

    it.each([
      { wire: 42, expected: '42' },
      { wire: '123.45', expected: '123.45' },
    ])('decodes $wire to $expected', ({ wire, expected }) => {
      expect(numericCodec.decode(wire)).toBe(expected);
    });
  });
});
