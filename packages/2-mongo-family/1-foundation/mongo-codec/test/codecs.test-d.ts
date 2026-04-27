import type { Codec as BaseCodec, CodecTrait } from '@prisma-next/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import type {
  MongoCodec,
  MongoCodecInput,
  MongoCodecOutput,
  MongoCodecTraits,
} from '../src/codecs';
import { mongoCodec } from '../src/codecs';

const equalityOnlyCodec = mongoCodec({
  typeId: 'test/equality@1',
  targetTypes: ['string'],
  traits: ['equality'],
  decode: (w: string) => w,
  encode: (v: string) => v,
});

const multiTraitCodec = mongoCodec({
  typeId: 'test/multi@1',
  targetTypes: ['string'],
  traits: ['equality', 'order', 'textual'],
  decode: (w: string) => w,
  encode: (v: string) => v,
});

const vectorCodec = mongoCodec({
  typeId: 'test/vector@1',
  targetTypes: ['vector'],
  traits: ['equality', 'numeric'],
  decode: (w: readonly number[]) => w,
  encode: (v: readonly number[]) => v,
});

test('MongoCodecTraits extracts single trait', () => {
  expectTypeOf<MongoCodecTraits<typeof equalityOnlyCodec>>().toEqualTypeOf<'equality'>();
});

test('MongoCodecTraits extracts multiple traits as union', () => {
  expectTypeOf<MongoCodecTraits<typeof multiTraitCodec>>().toEqualTypeOf<
    'equality' | 'order' | 'textual'
  >();
});

test('MongoCodecTraits extracts multiple traits from vector codec', () => {
  expectTypeOf<MongoCodecTraits<typeof vectorCodec>>().toEqualTypeOf<'equality' | 'numeric'>();
});

const traitlessCodec = mongoCodec({
  typeId: 'test/traitless@1',
  targetTypes: ['blob'],
  decode: (w: Buffer) => w,
  encode: (v: Buffer) => v,
});

test('MongoCodecTraits is never for codec without traits', () => {
  expectTypeOf<MongoCodecTraits<typeof traitlessCodec>>().toEqualTypeOf<never>();
});

// MongoCodec is a structural alias of `BaseCodec` — five generics in the
// same order, with `TOutput` defaulting to `TInput`. Confirm the alias
// remains identical at the type level so authors can hold a `BaseCodec`
// reference where a `MongoCodec` is expected.
test('MongoCodec is structurally identical to BaseCodec (5 generics, same order)', () => {
  expectTypeOf<MongoCodec<'id/x@1', readonly ['equality'], number, string, Date>>().toEqualTypeOf<
    BaseCodec<'id/x@1', readonly ['equality'], number, string, Date>
  >();
});

test('MongoCodec defaults TOutput to TInput when TOutput is omitted', () => {
  expectTypeOf<MongoCodec<'id/y@1', readonly CodecTrait[], number, string>>().toEqualTypeOf<
    MongoCodec<'id/y@1', readonly CodecTrait[], number, string, string>
  >();
});

// Asymmetric `TInput` ≠ `TOutput` must be expressible: the factory accepts
// distinct types in `encode`'s input and `decode`'s output positions, and
// the resulting codec must surface them on the method signatures (e.g.
// write `string`, read `Date`).
test('mongoCodec factory accepts encode TInput → TWire and decode TWire → TOutput where TInput ≠ TOutput', () => {
  const asymmetric = mongoCodec({
    typeId: 'demo/asymmetric@1',
    targetTypes: ['number'],
    encode: (value: string) => Number(value),
    decode: (wire: number) => new Date(wire),
  });

  expectTypeOf<Parameters<typeof asymmetric.encode>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<typeof asymmetric.encode>>().toExtend<Promise<number>>();
  expectTypeOf<Parameters<typeof asymmetric.decode>[0]>().toEqualTypeOf<number>();
  expectTypeOf<ReturnType<typeof asymmetric.decode>>().toExtend<Promise<Date>>();
});

// `MongoCodecInput<T>` / `MongoCodecOutput<T>` surface the canonical
// (symmetric) JS type for a Mongo codec — i.e. the input/output type when
// `TInput = TOutput`, which is the case used by built-in codecs.
test('MongoCodecInput / MongoCodecOutput extract the canonical JS type for symmetric codecs', () => {
  const symmetric = mongoCodec({
    typeId: 'demo/symmetric@1',
    targetTypes: ['string'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  expectTypeOf<MongoCodecInput<typeof symmetric>>().toEqualTypeOf<string>();
  expectTypeOf<MongoCodecOutput<typeof symmetric>>().toEqualTypeOf<string>();
});
