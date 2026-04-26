import { expectTypeOf, test } from 'vitest';
import type { MongoCodecTraits } from '../src/codecs';
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
  // Without `traits`, the unified factory leaves `traits?` as undefined, so the
  // resulting type parameter is `readonly CodecTrait[]` and the extracted
  // trait union is `CodecTrait`. We assert the extraction is the wide trait
  // type rather than `never` post-m4.
  expectTypeOf<MongoCodecTraits<typeof traitlessCodec>>().toEqualTypeOf<
    'equality' | 'order' | 'boolean' | 'numeric' | 'textual'
  >();
});
