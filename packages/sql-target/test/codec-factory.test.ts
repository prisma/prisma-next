import { describe, expect, it } from 'vitest';
import { codec } from '../src/codecs';

describe('codec() factory function', () => {
  it('creates codec with correct id, targetTypes, encode, decode', () => {
    const testCodec = codec({
      typeId: 'test/custom@1',
      targetTypes: ['custom'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    expect(testCodec.id).toBe('test/custom@1');
    expect(testCodec.targetTypes).toEqual(['custom']);
    expect(testCodec.encode).toBeDefined();
    expect(testCodec.decode).toBeDefined();
    expect(typeof testCodec.encode).toBe('function');
    expect(typeof testCodec.decode).toBe('function');
  });

  it('preserves literal type for id parameter', () => {
    const testCodec = codec({
      typeId: 'test/literal@1',
      targetTypes: ['literal'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    expect(testCodec.id).toBe('test/literal@1');
  });

  it('handles string/string wire and JS types', () => {
    const textCodec = codec({
      typeId: 'test/text@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    expect(textCodec.encode?.('hello')).toBe('hello');
    expect(textCodec.decode('world')).toBe('world');
  });

  it('handles number/number wire and JS types', () => {
    const intCodec = codec({
      typeId: 'test/int@1',
      targetTypes: ['int'],
      encode: (value: number) => value,
      decode: (wire: number) => wire,
    });

    expect(intCodec.encode?.(42)).toBe(42);
    expect(intCodec.decode(100)).toBe(100);
  });

  it('handles Date/string wire and JS types', () => {
    const dateCodec = codec({
      typeId: 'test/date@1',
      targetTypes: ['date'],
      encode: (value: Date): string => value.toISOString(),
      decode: (wire: string): Date => new Date(wire),
    });

    const testDate = new Date('2024-01-15T10:30:00Z');
    const encoded = dateCodec.encode?.(testDate);
    expect(encoded).toBe('2024-01-15T10:30:00.000Z');
    expect(typeof encoded).toBe('string');

    if (encoded === undefined) {
      throw new Error('encoded should be defined');
    }

    const decoded = dateCodec.decode(encoded);
    expect(decoded).toBeInstanceOf(Date);
    expect(decoded.getTime()).toBe(testDate.getTime());
  });

  it('returns codec that implements Codec interface correctly', () => {
    const testCodec = codec({
      typeId: 'test/interface@1',
      targetTypes: ['interface'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    expect(testCodec).toHaveProperty('id');
    expect(testCodec).toHaveProperty('targetTypes');
    expect(testCodec).toHaveProperty('encode');
    expect(testCodec).toHaveProperty('decode');
    expect(typeof testCodec.id).toBe('string');
    expect(Array.isArray(testCodec.targetTypes)).toBe(true);
  });

  it('handles multiple target types', () => {
    const multiCodec = codec({
      typeId: 'test/multi@1',
      targetTypes: ['type1', 'type2', 'type3'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    expect(multiCodec.targetTypes).toEqual(['type1', 'type2', 'type3']);
    expect(multiCodec.targetTypes.length).toBe(3);
  });

  it('handles codec without encode function', () => {
    const codecWithoutEncode = codec({
      typeId: 'test/no-encode@1',
      targetTypes: ['no-encode'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    expect(codecWithoutEncode.decode).toBeDefined();
    expect(codecWithoutEncode.decode('test')).toBe('test');
  });
});
