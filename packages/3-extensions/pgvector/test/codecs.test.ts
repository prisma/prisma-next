import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { pgVectorDescriptor } from '../src/core/codecs';

// The pgvector codec authors `encode`/`decode` synchronously; codecs route through `Promise`-returning methods at the boundary. The tests below cast through the Promise-returning shape and `await` every call so unit-level coverage stays aligned with the codec contract: `Codec<Id, TTraits, TWire, TInput>` — encode/decode return Promise.
type AsyncVectorCodec = {
  readonly encode: (value: number[]) => Promise<string>;
  readonly decode: (wire: string) => Promise<number[]>;
};

function asAsyncCodec(length: number): AsyncVectorCodec {
  // After F29, pgvector's runtime codec enforces the declared dimension; tests instantiate the codec at the dimension matching their value array.
  return pgVectorDescriptor.factory({ length })({
    name: 'test',
  }) as unknown as AsyncVectorCodec;
}

describe('pgvector codecs', () => {
  it(
    'has vector codec registered',
    () => {
      expect(pgVectorDescriptor.codecId).toBe('pg/vector@1');
      expect(pgVectorDescriptor.targetTypes).toEqual(['vector']);
    },
    timeouts.default,
  );

  it('encodes number array to PostgreSQL vector format', async () => {
    const vectorCodec = asAsyncCodec(4);
    const value = [0.1, 0.2, 0.3, 0.4];
    const encoded = await vectorCodec.encode(value);
    expect(encoded).toBe('[0.1,0.2,0.3,0.4]');
    expect(typeof encoded).toBe('string');
  });

  it('decodes PostgreSQL vector format string', async () => {
    const vectorCodec = asAsyncCodec(4);
    const wire = '[0.1,0.2,0.3,0.4]';
    const decoded = await vectorCodec.decode(wire);
    expect(decoded).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('round-trip encode/decode preserves values', async () => {
    const vectorCodec = asAsyncCodec(5);
    const original = [0.1, 0.2, 0.3, 0.4, 0.5];
    const encoded = await vectorCodec.encode(original);
    expect(typeof encoded).toBe('string');
    expect(encoded).toBe('[0.1,0.2,0.3,0.4,0.5]');
    const decoded = await vectorCodec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it('handles empty vector', async () => {
    const vectorCodec = asAsyncCodec(0);
    const original: number[] = [];
    const encoded = await vectorCodec.encode(original);
    expect(encoded).toBe('[]');
    const decoded = await vectorCodec.decode(encoded);
    expect(decoded).toEqual([]);
  });

  it('rejects when encoding non-array', async () => {
    const vectorCodec = asAsyncCodec(4);
    await expect(vectorCodec.encode('not an array' as unknown as number[])).rejects.toThrow(
      'Vector value must be an array of numbers',
    );
  });

  it('rejects when encoding array with non-numbers', async () => {
    const vectorCodec = asAsyncCodec(3);
    await expect(vectorCodec.encode([1, 2, 'three'] as unknown as number[])).rejects.toThrow(
      'Vector value must contain only numbers',
    );
  });

  it('rejects when decoding invalid string format', async () => {
    const vectorCodec = asAsyncCodec(4);
    await expect(vectorCodec.decode('not a vector format')).rejects.toThrow(
      'Invalid vector format: expected "[...]", got "not a vector format"',
    );
  });

  it('rejects when decoding non-string', async () => {
    const vectorCodec = asAsyncCodec(4);
    await expect(vectorCodec.decode(123 as unknown as string)).rejects.toThrow(
      'Vector wire value must be a string',
    );
  });

  it('rejects encoding when value length mismatches declared dimension (F29)', async () => {
    const vectorCodec = asAsyncCodec(3);
    await expect(vectorCodec.encode([1, 2])).rejects.toThrow(
      'Vector length mismatch: expected 3, got 2',
    );
    await expect(vectorCodec.encode([1, 2, 3, 4])).rejects.toThrow(
      'Vector length mismatch: expected 3, got 4',
    );
  });

  it('rejects decoding when wire length mismatches declared dimension (F29)', async () => {
    const vectorCodec = asAsyncCodec(3);
    await expect(vectorCodec.decode('[1,2]')).rejects.toThrow(
      'Vector length mismatch: expected 3, got 2',
    );
  });

  // The runtime materializes a representative codec for parameterized descriptors
  // via `factory(undefined)(ctx)` so undimensioned `vectorColumn` columns (no
  // `typeParams.length`) still resolve through codec encode/decode. This guards
  // against silently regressing back to passing arrays through node-postgres,
  // which formats them as PG array literals (`{"0.1","0.2"}`) rejected by the
  // `vector` type.
  it('factory(undefined) yields a length-agnostic codec (representative for undimensioned columns)', async () => {
    const factory = pgVectorDescriptor.factory as unknown as (
      params: undefined,
    ) => (ctx: { name: string }) => AsyncVectorCodec;
    const codec = factory(undefined)({ name: 'representative' });
    expect(await codec.encode([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]');
    expect(await codec.encode([1, 2, 3, 4, 5])).toBe('[1,2,3,4,5]');
    expect(await codec.decode('[0.4,0.5]')).toEqual([0.4, 0.5]);
  });
});
