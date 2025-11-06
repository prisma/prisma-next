import { describe, it, expect } from 'vitest';
import { codecDefinitions } from '../src/codecs';

describe('adapter-postgres codecs', () => {
  describe('timestamp codec', () => {
    const timestampCodec = codecDefinitions['timestamp'].codec as {
      encode: (value: string | Date) => string;
      decode: (wire: string | Date) => string;
    };

    it('encodes Date to ISO string', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const encoded = timestampCodec.encode!(date);
      expect(encoded).toBe('2024-01-15T10:30:00.000Z');
      expect(typeof encoded).toBe('string');
    });

    it('encodes string as-is', () => {
      const str = '2024-01-15T10:30:00Z';
      const encoded = timestampCodec.encode!(str);
      expect(encoded).toBe(str);
    });

    it('encodes non-string non-Date to string', () => {
      const num = 12345;
      // @ts-expect-error - Testing invalid input
      const encoded = timestampCodec.encode!(num);
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
    const timestamptzCodec = codecDefinitions['timestamptz'].codec as {
      encode: (value: string | Date) => string;
      decode: (wire: string | Date) => string;
    };

    it('encodes Date to ISO string', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const encoded = timestamptzCodec.encode!(date);
      expect(encoded).toBe('2024-01-15T10:30:00.000Z');
      expect(typeof encoded).toBe('string');
    });

    it('encodes string as-is', () => {
      const str = '2024-01-15T10:30:00Z';
      const encoded = timestamptzCodec.encode!(str);
      expect(encoded).toBe(str);
    });

    it('encodes non-string non-Date to string', () => {
      const num = 12345;
      // @ts-expect-error - Testing invalid input
      const encoded = timestamptzCodec.encode!(num);
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
});
