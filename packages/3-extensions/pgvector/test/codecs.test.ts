import type { Ctx } from '@prisma-next/framework-components/codec';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { vectorCodecForLength } from '../src/core/vector-codec';

// Phase 1 of codec-registry-unification consolidated the legacy `codec(...)`
// declaration into the curried-factory shape. These tests previously asserted
// against `codecDefinitions.vector.codec` from the legacy registry; they now
// assert against the codec the curried factory returns. Both forms shared
// encode/decode pre-Phase-1 (with drift); after Phase 1 there is one
// implementation, exercised here.

const ctx: Ctx = { name: '<anon:Doc.embedding>', usedAt: [{ table: 'Doc', column: 'embedding' }] };

describe('pgvector codec', () => {
  it(
    'has correct id and target types',
    () => {
      const codec = vectorCodecForLength(3)(ctx);
      expect(codec.id).toBe('pg/vector@1');
      expect(codec.targetTypes).toEqual(['vector']);
    },
    timeouts.default,
  );

  it('encodes number array to PostgreSQL vector format', () => {
    const codec = vectorCodecForLength(4)(ctx);
    expect(codec.encode?.([0.1, 0.2, 0.3, 0.4])).toBe('[0.1,0.2,0.3,0.4]');
  });

  it('decodes PostgreSQL vector format string', () => {
    const codec = vectorCodecForLength(4)(ctx);
    expect(codec.decode('[0.1,0.2,0.3,0.4]')).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('round-trip encode/decode preserves values', () => {
    const codec = vectorCodecForLength(5)(ctx);
    const original = [0.1, 0.2, 0.3, 0.4, 0.5];
    const encoded = codec.encode?.(original);
    expect(encoded).toBe('[0.1,0.2,0.3,0.4,0.5]');
    expect(codec.decode(encoded as string)).toEqual(original);
  });

  it('handles empty vector', () => {
    const codec = vectorCodecForLength(0)(ctx);
    const original: number[] = [];
    const encoded = codec.encode?.(original);
    expect(encoded).toBe('[]');
    expect(codec.decode(encoded as string)).toEqual([]);
  });

  it('throws error when encoding non-array', () => {
    const codec = vectorCodecForLength(3)(ctx);
    expect(() => {
      codec.encode?.('not an array' as unknown as number[]);
    }).toThrow('Vector value must be an array of numbers');
  });

  it('throws error when encoding array with non-numbers', () => {
    const codec = vectorCodecForLength(3)(ctx);
    expect(() => {
      codec.encode?.([1, 2, 'three'] as unknown as number[]);
    }).toThrow('Vector value must contain only numbers');
  });

  it('throws error when decoding invalid string format', () => {
    const codec = vectorCodecForLength(3)(ctx);
    expect(() => {
      codec.decode('not a vector format');
    }).toThrow('Invalid vector format: expected "[...]", got "not a vector format"');
  });

  it('throws error when decoding non-string', () => {
    const codec = vectorCodecForLength(3)(ctx);
    expect(() => {
      codec.decode(123 as unknown as string);
    }).toThrow('Vector wire value must be a string');
  });
});
