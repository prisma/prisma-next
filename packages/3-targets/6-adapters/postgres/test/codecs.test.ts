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

  describe('enum codec', () => {
    const enumCodec = codecDefinitions.enum.codec as {
      encode: (value: string) => string;
      decode: (wire: string) => string;
    };

    it('has correct typeId', () => {
      expect(codecDefinitions.enum.typeId).toBe('pg/enum@1');
    });

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

    it('handles various enum values', () => {
      const values = ['USER', 'ADMIN', 'MODERATOR', 'ACTIVE', 'INACTIVE'];
      for (const value of values) {
        expect(enumCodec.encode(value)).toBe(value);
        expect(enumCodec.decode(value)).toBe(value);
      }
    });
  });
});
