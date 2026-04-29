import type { Ctx } from '@prisma-next/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { vectorCodecForLength } from '../src/core/vector-factory';
import { pgVectorCodec } from '../src/exports/codecs';

const ctx: Ctx = { name: '<anon:Doc.embedding>', usedAt: [{ table: 'Doc', column: 'embedding' }] };

describe('vectorCodecForLength', () => {
  describe('encode', () => {
    it('formats a number array as the postgres vector text format', () => {
      const codec = vectorCodecForLength(3)(ctx);
      expect(codec.encode?.([1, 2, 3])).toBe('[1,2,3]');
    });

    it('handles empty arrays', () => {
      const codec = vectorCodecForLength(0)(ctx);
      expect(codec.encode?.([])).toBe('[]');
    });

    it('throws when value is not an array', () => {
      const codec = vectorCodecForLength(3)(ctx);
      expect(() => codec.encode?.('not-an-array' as unknown as number[])).toThrow(
        /Vector value must be an array of numbers/,
      );
    });

    it('throws when array contains non-numbers', () => {
      const codec = vectorCodecForLength(3)(ctx);
      expect(() => codec.encode?.([1, 'two' as unknown as number, 3])).toThrow(
        /Vector value must contain only numbers/,
      );
    });
  });

  describe('decode', () => {
    it('parses the postgres vector text format into a number array', () => {
      const codec = vectorCodecForLength(3)(ctx);
      expect(codec.decode('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('parses floats and trims whitespace inside elements', () => {
      const codec = vectorCodecForLength(3)(ctx);
      expect(codec.decode('[ 1.5 , -2.25 , 3 ]')).toEqual([1.5, -2.25, 3]);
    });

    it('returns an empty array for an empty vector', () => {
      const codec = vectorCodecForLength(0)(ctx);
      expect(codec.decode('[]')).toEqual([]);
    });

    it('throws when wire is not a string', () => {
      const codec = vectorCodecForLength(3)(ctx);
      expect(() => codec.decode(42 as unknown as string)).toThrow(
        /Vector wire value must be a string/,
      );
    });

    it('throws when the wire format does not bracket the contents', () => {
      const codec = vectorCodecForLength(3)(ctx);
      expect(() => codec.decode('1,2,3')).toThrow(/Invalid vector format/);
    });

    it('throws when an element is not parseable as a number', () => {
      const codec = vectorCodecForLength(3)(ctx);
      expect(() => codec.decode('[1,nope,3]')).toThrow(/is not a number/);
    });
  });

  describe('json round-trip', () => {
    it('encodeJson / decodeJson are wire-level identity', () => {
      const codec = vectorCodecForLength(3)(ctx);
      const value = [0.1, 0.2, 0.3];
      const json = codec.encodeJson(value as never);
      expect(json).toEqual(value);
      expect(codec.decodeJson(json)).toEqual(value);
    });
  });

  describe('codec metadata', () => {
    it('reports id, targetTypes, traits, and postgres nativeType meta', () => {
      const codec = vectorCodecForLength(1536)(ctx);
      expect(codec.id).toBe('pg/vector@1');
      expect(codec.targetTypes).toEqual(['vector']);
      expect(codec.traits).toEqual(['equality']);
      // `meta` lives on the SQL `Codec` extension (not the framework base);
      // the factory writes it and the SQL runtime registry reads it. Reach in
      // via a structural lookup to avoid pulling the SQL extension type into
      // a plain pgvector test.
      const meta = (
        codec as {
          readonly meta?: {
            readonly db?: {
              readonly sql?: { readonly postgres?: { readonly nativeType?: string } };
            };
          };
        }
      ).meta;
      expect(meta?.db?.sql?.postgres?.nativeType).toBe('vector');
    });
  });
});

describe('pgVectorCodec descriptor', () => {
  it('codecId is pg/vector@1', () => {
    expect(pgVectorCodec.codecId).toBe('pg/vector@1');
  });

  it('renderOutputType produces Vector<length>', () => {
    expect(pgVectorCodec.renderOutputType?.({ length: 1536 })).toBe('Vector<1536>');
  });

  it('paramsSchema accepts a valid integer length', () => {
    const result = pgVectorCodec.paramsSchema['~standard'].validate({ length: 1536 });
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeUndefined();
  });

  it('paramsSchema rejects a non-integer length', () => {
    const result = pgVectorCodec.paramsSchema['~standard'].validate({ length: 1.5 });
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeDefined();
  });

  it('paramsSchema rejects out-of-range lengths', () => {
    const negative = pgVectorCodec.paramsSchema['~standard'].validate({ length: -1 });
    if (negative instanceof Promise) throw new Error('expected sync validator');
    expect(negative.issues).toBeDefined();
  });

  it('factory delegates to vectorCodecForLength and produces a working codec', () => {
    const codec = pgVectorCodec.factory({ length: 1536 })(ctx);
    expect(codec.id).toBe('pg/vector@1');
    expect(codec.encode?.([1, 2, 3])).toBe('[1,2,3]');
  });
});
