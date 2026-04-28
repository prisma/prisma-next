import type { JsonValue } from '@prisma-next/contract/types';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { expectTypeOf, test } from 'vitest';
import type { Codec, CodecTrait, Ctx, ParameterizedCodecDescriptor } from '../src/codec-types';

interface VectorN<N extends number> {
  readonly length: N;
  readonly values: readonly number[];
}

function vector<N extends number>(length: N) {
  return (_ctx: Ctx): Codec<'fixture/vector@1', readonly ['equality'], string, VectorN<N>> => ({
    id: 'fixture/vector@1',
    targetTypes: ['vector'] as const,
    traits: ['equality'] as const,
    encode: (v) => `[${v.values.join(',')}]`,
    decode: () => ({ length, values: [] }),
    encodeJson: (v) => v as unknown as JsonValue,
    decodeJson: (j) => j as unknown as VectorN<N>,
  });
}

function cipherStashLike(params: { readonly keyId: string }) {
  return (ctx: Ctx): Codec<'fixture/cs@1', readonly ['equality'], string, string> => {
    const sites = ctx.usedAt.map(({ table, column }) => `${table}.${column}`);
    const tag = `${params.keyId}|${sites.join(',')}`;
    return {
      id: 'fixture/cs@1',
      targetTypes: ['text'] as const,
      traits: ['equality'] as const,
      encode: (v) => `${tag}:${v}`,
      decode: (w) => w,
      encodeJson: (v) => v,
      decodeJson: (j) => j as string,
    };
  };
}

function makeStandardSchema<P>(): StandardSchemaV1<P> {
  return {
    '~standard': {
      version: 1,
      vendor: 'fixture',
      validate: (value) => ({ value: value as P }),
    },
  };
}

type CodecJs<C> = C extends Codec<string, readonly CodecTrait[], unknown, infer Js> ? Js : never;

test('AC-1: vector(1536) typechecks as (ctx) => Codec<…, VectorN<1536>>', () => {
  type V1536 = ReturnType<typeof vector<1536>>;
  expectTypeOf<V1536>().parameter(0).toEqualTypeOf<Ctx>();
  expectTypeOf<CodecJs<ReturnType<V1536>>>().toEqualTypeOf<VectorN<1536>>();
});

test('AC-1: literal numeric param flows through (1536, not number)', () => {
  const partial = vector(1536);
  expectTypeOf(partial).parameter(0).toEqualTypeOf<Ctx>();
  expectTypeOf<CodecJs<ReturnType<typeof partial>>>().toEqualTypeOf<VectorN<1536>>();
});

test('AC-6: a fixture factory using ctx.usedAt typechecks', () => {
  const partial = cipherStashLike({ keyId: 'k' });
  expectTypeOf(partial).parameter(0).toEqualTypeOf<Ctx>();
  expectTypeOf<CodecJs<ReturnType<typeof partial>>>().toEqualTypeOf<string>();
});

test('AC-1: descriptor factory typing matches the function', () => {
  const fixtureDescriptor: ParameterizedCodecDescriptor<{ readonly length: number }> = {
    codecId: 'fixture/vector@1',
    paramsSchema: makeStandardSchema<{ readonly length: number }>(),
    renderOutputType: ({ length }) => `VectorN<${length}>`,
    factory: (params) => vector(params.length),
  };
  expectTypeOf(fixtureDescriptor.factory).toEqualTypeOf<
    (params: { readonly length: number }) => (ctx: Ctx) => Codec
  >();
});

test('Ctx shape locked at { name, usedAt }', () => {
  expectTypeOf<Ctx>().toEqualTypeOf<{
    readonly name: string;
    readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
  }>();
});

test('ParameterizedCodecDescriptor.paramsSchema is StandardSchemaV1<P>', () => {
  type Descriptor = ParameterizedCodecDescriptor<{ readonly length: number }>;
  expectTypeOf<Descriptor['paramsSchema']>().toEqualTypeOf<
    StandardSchemaV1<{ readonly length: number }>
  >();
});

test('renderOutputType is removed from the base Codec interface', () => {
  type Keys = keyof Codec;
  expectTypeOf<Keys>().not.toMatchTypeOf<'renderOutputType'>();
});
