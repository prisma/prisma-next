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
    traits: ['equality'],
    targetTypes: ['vector'],
    paramsSchema: makeStandardSchema<{ readonly length: number }>(),
    renderOutputType: ({ length }) => `VectorN<${length}>`,
    factory: (params) => vector(params.length),
  };
  expectTypeOf(fixtureDescriptor.factory).toEqualTypeOf<
    (params: { readonly length: number }) => (ctx: Ctx) => Codec
  >();
});

// AC-1.e (positive assignability): a typed factory function whose params and
// resolved Codec match the descriptor's `P` is assignable to the descriptor's
// `factory` slot — even though the slot's nominal return type erases the Codec's
// `Js` parameter (intentional for registry-keyed dispatch). The Codec's `Js` slot
// is preserved at the call site (M2's no-emit `FieldOutputType` reads it from the
// column expression directly, not through the descriptor).
test('AC-1.e: a typed factory function is assignable to descriptor.factory', () => {
  type DescFactory = ParameterizedCodecDescriptor<{ readonly length: number }>['factory'];

  function vectorFactory(params: { readonly length: number }) {
    return vector(params.length);
  }

  expectTypeOf<typeof vectorFactory>().toExtend<DescFactory>();
});

// AC-1.e (negative): a factory whose params shape is wider than the descriptor's
// `P` is not assignable. Excess-property contravariance means the descriptor will
// pass `{ length: number }` but the candidate insists on `{ length: number; foo: string }`,
// which the descriptor cannot supply.
test('AC-1.e: a factory with wider params does NOT assign to descriptor.factory', () => {
  type DescFactory = ParameterizedCodecDescriptor<{ readonly length: number }>['factory'];

  function widerFactory(_params: { readonly length: number; readonly foo: string }) {
    return vector(_params.length);
  }

  // @ts-expect-error widerFactory requires `foo`, which the descriptor's caller
  // does not supply (params is contravariant).
  const _assigned: DescFactory = widerFactory;
  expectTypeOf<typeof widerFactory>().not.toExtend<DescFactory>();
});

// AC-1.e (negative): a factory whose inner function returns the wrong `Codec`
// (e.g. a non-Codec value) does not assign — the descriptor's slot demands
// `(ctx: Ctx) => Codec`.
test('AC-1.e: a factory whose inner function returns a non-Codec does NOT assign', () => {
  type DescFactory = ParameterizedCodecDescriptor<{ readonly length: number }>['factory'];

  function wrongReturn(_params: { readonly length: number }) {
    return (_ctx: Ctx) => ({ notACodec: true });
  }

  // @ts-expect-error inner return value lacks Codec's required fields.
  const _assigned: DescFactory = wrongReturn;
  expectTypeOf<typeof wrongReturn>().not.toExtend<DescFactory>();
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
