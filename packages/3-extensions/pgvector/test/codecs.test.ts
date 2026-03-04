import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { codecDefinitions } from '../src/core/codecs';

describe('pgvector codecs', () => {
  it(
    'has vector codec registered',
    () => {
      const vectorDef = codecDefinitions.vector;
      expect(vectorDef).toBeDefined();
      expect(vectorDef.typeId).toBe('pg/vector@1');
      expect(vectorDef.codec.targetTypes).toEqual(['vector']);
    },
    timeouts.default,
  );

  it('encodes number array to PostgreSQL vector format', () => {
    const vectorCodec = codecDefinitions.vector.codec;

    const value = [0.1, 0.2, 0.3, 0.4];
    const encoded = vectorCodec.encode!(value);
    expect(encoded).toBe('[0.1,0.2,0.3,0.4]');
    expect(typeof encoded).toBe('string');
  });

  it('decodes PostgreSQL vector format string', () => {
    const vectorCodec = codecDefinitions.vector.codec;

    const wire = '[0.1,0.2,0.3,0.4]';
    const decoded = vectorCodec.decode(wire);
    expect(decoded).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('round-trip encode/decode preserves values', () => {
    const vectorCodec = codecDefinitions.vector.codec;

    const original = [0.1, 0.2, 0.3, 0.4, 0.5];
    const encoded = vectorCodec.encode!(original);
    expect(typeof encoded).toBe('string');
    expect(encoded).toBe('[0.1,0.2,0.3,0.4,0.5]');
    const decoded = vectorCodec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it('handles empty vector', () => {
    const vectorCodec = codecDefinitions.vector.codec;

    const original: number[] = [];
    const encoded = vectorCodec.encode!(original);
    expect(encoded).toBe('[]');
    const decoded = vectorCodec.decode(encoded);
    expect(decoded).toEqual([]);
  });

  it('throws error when encoding non-array', () => {
    const vectorCodec = codecDefinitions.vector.codec;

    expect(() => {
      vectorCodec.encode!('not an array' as unknown as number[]);
    }).toThrow('Vector value must be an array of numbers');
  });

  it('throws error when encoding array with non-numbers', () => {
    const vectorCodec = codecDefinitions.vector.codec;

    expect(() => {
      vectorCodec.encode!([1, 2, 'three'] as unknown as number[]);
    }).toThrow('Vector value must contain only numbers');
  });

  it('throws error when decoding invalid string format', () => {
    const vectorCodec = codecDefinitions.vector.codec;

    expect(() => {
      vectorCodec.decode('not a vector format');
    }).toThrow('Invalid vector format: expected "[...]", got "not a vector format"');
  });

  it('throws error when decoding non-string', () => {
    const vectorCodec = codecDefinitions.vector.codec;

    expect(() => {
      vectorCodec.decode(123 as unknown as string);
    }).toThrow('Vector wire value must be a string');
  });
});
