import type { Ctx } from '@prisma-next/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  mongoVectorCodecForLength,
  mongoVectorParameterizedCodec,
  vector,
} from '../src/codecs/vector-factory';

const ctx: Ctx = { name: '<anon:Doc.embedding>', usedAt: [{ table: 'Doc', column: 'embedding' }] };

describe('mongoVectorCodecForLength', () => {
  it('encode passes the value through (Mongo wire is the array itself)', () => {
    const codec = mongoVectorCodecForLength(3)(ctx);
    const value = [1, 2, 3] as const;
    expect(codec.encode?.(value as never)).toEqual(value);
  });

  it('decode passes the wire through', () => {
    const codec = mongoVectorCodecForLength(3)(ctx);
    const wire = [1, 2, 3] as const;
    expect(codec.decode(wire as never)).toEqual(wire);
  });

  it('json round-trip is identity', () => {
    const codec = mongoVectorCodecForLength(3)(ctx);
    const value = [0.1, 0.2, 0.3];
    const json = codec.encodeJson(value as never);
    expect(json).toEqual(value);
    expect(codec.decodeJson(json)).toEqual(value);
  });

  it('reports id, targetTypes, and traits', () => {
    const codec = mongoVectorCodecForLength(1536)(ctx);
    expect(codec.id).toBe('mongo/vector@1');
    expect(codec.targetTypes).toEqual(['vector']);
    expect(codec.traits).toEqual(['equality']);
  });
});

describe('vector(N) column-author surface', () => {
  it('returns a descriptor carrying the data part and the type slot', () => {
    const descriptor = vector(1536);
    expect(descriptor.codecId).toBe('mongo/vector@1');
    expect(descriptor.nativeType).toBe('vector');
    expect(descriptor.typeParams).toEqual({ length: 1536 });
    expect(typeof descriptor.type).toBe('function');
  });

  it('descriptor.type produces a working codec when applied to a Ctx', () => {
    const descriptor = vector(3);
    const codec = descriptor.type(ctx);
    expect(codec.id).toBe('mongo/vector@1');
    expect(codec.encode?.([1, 2, 3] as never)).toEqual([1, 2, 3]);
  });

  it('throws RangeError when length is not a positive integer', () => {
    expect(() => vector(0)).toThrow(RangeError);
    expect(() => vector(-1)).toThrow(RangeError);
    expect(() => vector(1.5)).toThrow(RangeError);
  });
});

describe('mongoVectorParameterizedCodec descriptor', () => {
  it('codecId is mongo/vector@1', () => {
    expect(mongoVectorParameterizedCodec.codecId).toBe('mongo/vector@1');
  });

  it('renderOutputType produces Vector<length>', () => {
    expect(mongoVectorParameterizedCodec.renderOutputType?.({ length: 1536 })).toBe('Vector<1536>');
  });

  it('paramsSchema accepts a valid integer length', () => {
    const result = mongoVectorParameterizedCodec.paramsSchema['~standard'].validate({
      length: 1536,
    });
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeUndefined();
  });

  it('paramsSchema rejects a non-positive length', () => {
    const result = mongoVectorParameterizedCodec.paramsSchema['~standard'].validate({ length: 0 });
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeDefined();
  });

  it('factory delegates to mongoVectorCodecForLength', () => {
    const codec = mongoVectorParameterizedCodec.factory({ length: 1536 })(ctx);
    expect(codec.id).toBe('mongo/vector@1');
  });
});
