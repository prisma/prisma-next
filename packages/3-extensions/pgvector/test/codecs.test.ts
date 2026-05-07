import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { pgVectorDescriptorClass } from '../src/core/codecs-class';

// The pgvector codec authors `encode`/`decode` synchronously; class-form
// codecs route through `Promise`-returning methods at the boundary. The
// tests below cast through the Promise-returning shape and `await` every
// call so unit-level coverage stays aligned with the codec contract:
//   `Codec<Id, TTraits, TWire, TInput>` — encode/decode return Promise.
type AsyncVectorCodec = {
  readonly encode: (value: number[]) => Promise<string>;
  readonly decode: (wire: string) => Promise<number[]>;
};

function asAsyncCodec(): AsyncVectorCodec {
  // pgvector's runtime `encode`/`decode` are parameter-stateless — the
  // descriptor's `factory(params)` returns the same closure regardless
  // of `params`; supply a representative shape so the type-side
  // `VectorParams` constraint is honoured.
  return pgVectorDescriptorClass.factory({ length: 4 })({
    name: 'test',
  }) as unknown as AsyncVectorCodec;
}

describe('pgvector codecs', () => {
  it(
    'has vector codec registered',
    () => {
      expect(pgVectorDescriptorClass.codecId).toBe('pg/vector@1');
      expect(pgVectorDescriptorClass.targetTypes).toEqual(['vector']);
    },
    timeouts.default,
  );

  it('encodes number array to PostgreSQL vector format', async () => {
    const vectorCodec = asAsyncCodec();

    const value = [0.1, 0.2, 0.3, 0.4];
    const encoded = await vectorCodec.encode(value);
    expect(encoded).toBe('[0.1,0.2,0.3,0.4]');
    expect(typeof encoded).toBe('string');
  });

  it('decodes PostgreSQL vector format string', async () => {
    const vectorCodec = asAsyncCodec();

    const wire = '[0.1,0.2,0.3,0.4]';
    const decoded = await vectorCodec.decode(wire);
    expect(decoded).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('round-trip encode/decode preserves values', async () => {
    const vectorCodec = asAsyncCodec();

    const original = [0.1, 0.2, 0.3, 0.4, 0.5];
    const encoded = await vectorCodec.encode(original);
    expect(typeof encoded).toBe('string');
    expect(encoded).toBe('[0.1,0.2,0.3,0.4,0.5]');
    const decoded = await vectorCodec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it('handles empty vector', async () => {
    const vectorCodec = asAsyncCodec();

    const original: number[] = [];
    const encoded = await vectorCodec.encode(original);
    expect(encoded).toBe('[]');
    const decoded = await vectorCodec.decode(encoded);
    expect(decoded).toEqual([]);
  });

  it('rejects when encoding non-array', async () => {
    const vectorCodec = asAsyncCodec();

    await expect(vectorCodec.encode('not an array' as unknown as number[])).rejects.toThrow(
      'Vector value must be an array of numbers',
    );
  });

  it('rejects when encoding array with non-numbers', async () => {
    const vectorCodec = asAsyncCodec();

    await expect(vectorCodec.encode([1, 2, 'three'] as unknown as number[])).rejects.toThrow(
      'Vector value must contain only numbers',
    );
  });

  it('rejects when decoding invalid string format', async () => {
    const vectorCodec = asAsyncCodec();

    await expect(vectorCodec.decode('not a vector format')).rejects.toThrow(
      'Invalid vector format: expected "[...]", got "not a vector format"',
    );
  });

  it('rejects when decoding non-string', async () => {
    const vectorCodec = asAsyncCodec();

    await expect(vectorCodec.decode(123 as unknown as string)).rejects.toThrow(
      'Vector wire value must be a string',
    );
  });
});
