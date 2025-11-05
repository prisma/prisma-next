import { expectTypeOf, test } from 'vitest';
import { codec, type Codec } from '../src/codecs';

test('codec() creates Codec with literal ID type', () => {
  const testCodec = codec<'test/literal@1', string, string>({
    typeId: 'test/literal@1',
    targetTypes: ['literal'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  // Verify literal ID type is preserved (not widened to string)
  expectTypeOf<typeof testCodec.id>().toEqualTypeOf<'test/literal@1'>();
  expectTypeOf<typeof testCodec>().toExtend<Codec<'test/literal@1', string, string>>();
});

test('codec() preserves literal ID from inference', () => {
  const testCodec = codec({
    typeId: 'test/inferred@1' as const,
    targetTypes: ['inferred'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  // Verify literal ID type is preserved when using as const
  expectTypeOf<typeof testCodec.id>().toEqualTypeOf<'test/inferred@1'>();
});

test('codec() preserves input type (TJs)', () => {
  const stringCodec = codec<'test/string@1', string, string>({
    typeId: 'test/string@1',
    targetTypes: ['string'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  const numberCodec = codec<'test/number@1', number, number>({
    typeId: 'test/number@1',
    targetTypes: ['number'],
    encode: (value: number) => value,
    decode: (wire: number) => wire,
  });

  const dateCodec = codec<'test/date@1', string, Date>({
    typeId: 'test/date@1',
    targetTypes: ['date'],
    encode: (value: Date): string => value.toISOString(),
    decode: (wire: string): Date => new Date(wire),
  });

  // Verify input types are preserved (encode is optional, so we check NonNullable)
  expectTypeOf<Parameters<NonNullable<typeof stringCodec.encode>>[0]>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<NonNullable<typeof numberCodec.encode>>[0]>().toEqualTypeOf<number>();
  expectTypeOf<Parameters<NonNullable<typeof dateCodec.encode>>[0]>().toEqualTypeOf<Date>();
});

test('codec() preserves output type (TJs)', () => {
  const stringCodec = codec<'test/string@1', string, string>({
    typeId: 'test/string@1',
    targetTypes: ['string'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  const numberCodec = codec<'test/number@1', number, number>({
    typeId: 'test/number@1',
    targetTypes: ['number'],
    encode: (value: number) => value,
    decode: (wire: number) => wire,
  });

  const dateCodec = codec<'test/date@1', string, Date>({
    typeId: 'test/date@1',
    targetTypes: ['date'],
    encode: (value: Date): string => value.toISOString(),
    decode: (wire: string): Date => new Date(wire),
  });

  // Verify output types are preserved
  expectTypeOf<ReturnType<typeof stringCodec.decode>>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<typeof numberCodec.decode>>().toEqualTypeOf<number>();
  expectTypeOf<ReturnType<typeof dateCodec.decode>>().toEqualTypeOf<Date>();
});

test('codec() preserves wire type (TWire)', () => {
  const stringCodec = codec<'test/string@1', string, string>({
    typeId: 'test/string@1',
    targetTypes: ['string'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  const dateCodec = codec<'test/date@1', string, Date>({
    typeId: 'test/date@1',
    targetTypes: ['date'],
    encode: (value: Date): string => value.toISOString(),
    decode: (wire: string): Date => new Date(wire),
  });

  // Verify wire types are preserved (encode is optional, so we check NonNullable)
  expectTypeOf<ReturnType<NonNullable<typeof stringCodec.encode>>>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<typeof stringCodec.decode>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<NonNullable<typeof dateCodec.encode>>>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<typeof dateCodec.decode>[0]>().toEqualTypeOf<string>();
});

