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

// Cross-family parity (m4): MongoCodec must be structurally identical to
// BaseCodec — i.e. five generics in the same order, with TOutput defaulting
// to TInput. The SQL family's Codec exposes the same shape (extends BaseCodec
// with the same generics plus SQL-only metadata), so a single codec value
// can be registered in both family registries.
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

// Asymmetric TInput ≠ TOutput is now expressible (the pre-m4 4-generic shape
// collapsed both into a single TJs slot, so the asymmetric case was
// structurally impossible). The factory must accept distinct types in
// `encode`'s input and `decode`'s output positions, and the resulting codec
// must surface them on the method signatures.
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

// Extractor parity with SQL's `CodecInput<T>` / `CodecOutput<T>`: surface the
// canonical (symmetric) JS type for a Mongo codec. The extractors mirror
// SQL's structural pattern (positional `infer` on the BaseCodec generics)
// and therefore behave identically on the canonical case where TInput =
// TOutput, which is the case used everywhere in the cross-family parity
// fixtures and built-in codec set.
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
