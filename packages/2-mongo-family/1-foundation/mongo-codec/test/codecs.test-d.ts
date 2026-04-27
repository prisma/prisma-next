import type { Codec as BaseCodec } from '@prisma-next/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import type { MongoCodec, MongoCodecInput, MongoCodecTraits } from '../src/codecs';
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

// MongoCodec is a structural alias of `BaseCodec` — same four generics in
// the same order. Confirm the alias remains identical at the type level so
// authors can hold a `BaseCodec` reference where a `MongoCodec` is expected.
test('MongoCodec is structurally identical to BaseCodec (4 generics, same order)', () => {
  expectTypeOf<MongoCodec<'id/x@1', readonly ['equality'], number, string>>().toEqualTypeOf<
    BaseCodec<'id/x@1', readonly ['equality'], number, string>
  >();
});

// `MongoCodecInput<T>` surfaces the JS application type of a Mongo codec
// — used both as `encode`'s input and as `decode`'s output, since the codec
// translates one JS application type to/from one wire format.
test('MongoCodecInput extracts the JS application type used for both write input and read output', () => {
  const text = mongoCodec({
    typeId: 'demo/text@1',
    targetTypes: ['string'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  expectTypeOf<MongoCodecInput<typeof text>>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<typeof text.encode>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<typeof text.decode>>().toExtend<Promise<string>>();
});
