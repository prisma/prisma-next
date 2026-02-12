import { describe, expect, it } from 'vitest';
import { codecDefinitions } from '../src/core/codecs';

describe('adapter-postgres codecs', () => {
  describe('timestamp codec', () => {
    const timestampCodec = codecDefinitions.timestamp.codec as {
      encode: (value: string | Date) => string;
      decode: (wire: string | Date) => string;
    };

    it('encodes Date to ISO string', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const encoded = timestampCodec.encode?.(date);
      expect(encoded).toBe('2024-01-15T10:30:00.000Z');
      expect(typeof encoded).toBe('string');
    });

    it('encodes string as-is', () => {
      const str = '2024-01-15T10:30:00Z';
      const encoded = timestampCodec.encode?.(str);
      expect(encoded).toBe(str);
    });

    it('encodes non-string non-Date to string', () => {
      const num = 12345;
      // @ts-expect-error - Testing invalid input
      const encoded = timestampCodec.encode?.(num);
      expect(typeof encoded).toBe('string');
    });

    it('decodes string as-is', () => {
      const str = '2024-01-15T10:30:00Z';
      const decoded = timestampCodec.decode(str);
      expect(decoded).toBe(str);
    });

    it('decodes Date to ISO string', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const decoded = timestampCodec.decode(date);
      expect(decoded).toBe('2024-01-15T10:30:00.000Z');
    });

    it('decodes non-string non-Date to string', () => {
      const num = 12345;
      // @ts-expect-error - Testing invalid input
      const decoded = timestampCodec.decode(num);
      expect(typeof decoded).toBe('string');
    });
  });

  describe('timestamptz codec', () => {
    const timestamptzCodec = codecDefinitions.timestamptz.codec as {
      encode: (value: string | Date) => string;
      decode: (wire: string | Date) => string;
    };

    it('encodes Date to ISO string', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const encoded = timestamptzCodec.encode?.(date);
      expect(encoded).toBe('2024-01-15T10:30:00.000Z');
      expect(typeof encoded).toBe('string');
    });

    it('encodes string as-is', () => {
      const str = '2024-01-15T10:30:00Z';
      const encoded = timestamptzCodec.encode?.(str);
      expect(encoded).toBe(str);
    });

    it('encodes non-string non-Date to string', () => {
      const num = 12345;
      // @ts-expect-error - Testing invalid input
      const encoded = timestamptzCodec.encode?.(num);
      expect(typeof encoded).toBe('string');
    });

    it('decodes string as-is', () => {
      const str = '2024-01-15T10:30:00Z';
      const decoded = timestamptzCodec.decode(str);
      expect(decoded).toBe(str);
    });

    it('decodes Date to ISO string', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const decoded = timestamptzCodec.decode(date);
      expect(decoded).toBe('2024-01-15T10:30:00.000Z');
    });

    it('decodes non-string non-Date to string', () => {
      const num = 12345;
      // @ts-expect-error - Testing invalid input
      const decoded = timestamptzCodec.decode(num);
      expect(typeof decoded).toBe('string');
    });
  });

  describe('text codec', () => {
    const textCodec = codecDefinitions.text.codec as {
      encode: (value: string) => string;
      decode: (wire: string) => string;
    };

    it('encodes string as-is', () => {
      const str = 'test string';
      const encoded = textCodec.encode(str);
      expect(encoded).toBe(str);
    });

    it('decodes string as-is', () => {
      const str = 'test string';
      const decoded = textCodec.decode(str);
      expect(decoded).toBe(str);
    });
  });

  describe('enum codec', () => {
    const enumCodec = codecDefinitions.enum.codec as {
      encode: (value: string) => string;
      decode: (wire: string) => string;
    };

    it('encodes string as-is', () => {
      const value = 'ADMIN';
      const encoded = enumCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes string as-is', () => {
      const value = 'USER';
      const decoded = enumCodec.decode(value);
      expect(decoded).toBe(value);
    });
  });

  describe('int4 codec', () => {
    const int4Codec = codecDefinitions.int4.codec as {
      encode: (value: number) => number;
      decode: (wire: number) => number;
    };

    it('encodes number as-is', () => {
      const num = 42;
      const encoded = int4Codec.encode(num);
      expect(encoded).toBe(num);
    });

    it('decodes number as-is', () => {
      const num = 42;
      const decoded = int4Codec.decode(num);
      expect(decoded).toBe(num);
    });
  });

  describe('int2 codec', () => {
    const int2Codec = codecDefinitions.int2.codec as {
      encode: (value: number) => number;
      decode: (wire: number) => number;
    };

    it('encodes number as-is', () => {
      const num = 42;
      const encoded = int2Codec.encode(num);
      expect(encoded).toBe(num);
    });

    it('decodes number as-is', () => {
      const num = 42;
      const decoded = int2Codec.decode(num);
      expect(decoded).toBe(num);
    });
  });

  describe('int8 codec', () => {
    const int8Codec = codecDefinitions.int8.codec as {
      encode: (value: number) => number;
      decode: (wire: number) => number;
    };

    it('encodes number as-is', () => {
      const num = 42;
      const encoded = int8Codec.encode(num);
      expect(encoded).toBe(num);
    });

    it('decodes number as-is', () => {
      const num = 42;
      const decoded = int8Codec.decode(num);
      expect(decoded).toBe(num);
    });
  });

  describe('float4 codec', () => {
    const float4Codec = codecDefinitions.float4.codec as {
      encode: (value: number) => number;
      decode: (wire: number) => number;
    };

    it('encodes number as-is', () => {
      const num = 3.14;
      const encoded = float4Codec.encode(num);
      expect(encoded).toBe(num);
    });

    it('decodes number as-is', () => {
      const num = 3.14;
      const decoded = float4Codec.decode(num);
      expect(decoded).toBe(num);
    });
  });

  describe('float8 codec', () => {
    const float8Codec = codecDefinitions.float8.codec as {
      encode: (value: number) => number;
      decode: (wire: number) => number;
    };

    it('encodes number as-is', () => {
      const num = 3.14;
      const encoded = float8Codec.encode(num);
      expect(encoded).toBe(num);
    });

    it('decodes number as-is', () => {
      const num = 3.14;
      const decoded = float8Codec.decode(num);
      expect(decoded).toBe(num);
    });
  });

  describe('bool codec', () => {
    const boolCodec = codecDefinitions.bool.codec as {
      encode: (value: boolean) => boolean;
      decode: (wire: boolean) => boolean;
    };

    it('encodes boolean as-is', () => {
      const value = true;
      const encoded = boolCodec.encode(value);
      expect(encoded).toBe(value);
    });

    it('decodes boolean as-is', () => {
      const value = false;
      const decoded = boolCodec.decode(value);
      expect(decoded).toBe(value);
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
      decode: (wire: string) => string;
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
