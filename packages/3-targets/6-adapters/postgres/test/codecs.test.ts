import { describe, expect, it } from 'vitest';
import { codecDefinitions } from '../src/core/codecs';

describe('adapter-postgres codecs', () => {
  it('exports expected codec scalars', () => {
    expect(Object.keys(codecDefinitions).sort()).toEqual([
      'bool',
      'enum',
      'float4',
      'float8',
      'int2',
      'int4',
      'int8',
      'json',
      'jsonb',
      'text',
      'timestamp',
      'timestamptz',
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
});
