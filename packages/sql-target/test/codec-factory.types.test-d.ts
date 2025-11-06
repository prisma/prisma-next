import { expectTypeOf, test } from 'vitest';
import { type Codec, codec } from '../src/codecs';

test('codec() creates Codec with literal ID type', () => {
  // biome-ignore lint/correctness/noUnusedVariables: variable used for type checking
  const _testCodec = codec<'test/literal@1', string, string>({
    typeId: 'test/literal@1',
    targetTypes: ['literal'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  // Verify literal ID type is preserved (not widened to string)
  expectTypeOf<typeof _testCodec.id>().toEqualTypeOf<'test/literal@1'>();
  expectTypeOf<typeof _testCodec>().toExtend<Codec<'test/literal@1', string, string>>();
});

test('codec() preserves literal ID from inference', () => {
  // biome-ignore lint/correctness/noUnusedVariables: variable used for type checking
  const _testCodec = codec({
    typeId: 'test/inferred@1' as const,
    targetTypes: ['inferred'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  // Verify literal ID type is preserved when using as const
  expectTypeOf<typeof _testCodec.id>().toEqualTypeOf<'test/inferred@1'>();
});

test('codec() preserves input type (TJs)', () => {
  // biome-ignore lint/correctness/noUnusedVariables: variable used for type checking
  const _stringCodec = codec<'test/string@1', string, string>({
    typeId: 'test/string@1',
    targetTypes: ['string'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  // biome-ignore lint/correctness/noUnusedVariables: variable used for type checking
  const _numberCodec = codec<'test/number@1', number, number>({
    typeId: 'test/number@1',
    targetTypes: ['number'],
    encode: (value: number) => value,
    decode: (wire: number) => wire,
  });

  // biome-ignore lint/correctness/noUnusedVariables: variable used for type checking
  const _dateCodec = codec<'test/date@1', string, Date>({
    typeId: 'test/date@1',
    targetTypes: ['date'],
    encode: (value: Date): string => value.toISOString(),
    decode: (wire: string): Date => new Date(wire),
  });

  // Verify input types are preserved (encode is optional, so we check NonNullable)
  expectTypeOf<Parameters<NonNullable<typeof _stringCodec.encode>>[0]>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<NonNullable<typeof _numberCodec.encode>>[0]>().toEqualTypeOf<number>();
  expectTypeOf<Parameters<NonNullable<typeof _dateCodec.encode>>[0]>().toEqualTypeOf<Date>();
});

test('codec() preserves output type (TJs)', () => {
  // biome-ignore lint/correctness/noUnusedVariables: variable used for type checking
  const _stringCodec = codec<'test/string@1', string, string>({
    typeId: 'test/string@1',
    targetTypes: ['string'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  // biome-ignore lint/correctness/noUnusedVariables: variable used for type checking
  const _numberCodec = codec<'test/number@1', number, number>({
    typeId: 'test/number@1',
    targetTypes: ['number'],
    encode: (value: number) => value,
    decode: (wire: number) => wire,
  });

  // biome-ignore lint/correctness/noUnusedVariables: variable used for type checking
  const _dateCodec = codec<'test/date@1', string, Date>({
    typeId: 'test/date@1',
    targetTypes: ['date'],
    encode: (value: Date): string => value.toISOString(),
    decode: (wire: string): Date => new Date(wire),
  });

  // Verify output types are preserved
  expectTypeOf<ReturnType<typeof _stringCodec.decode>>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<typeof _numberCodec.decode>>().toEqualTypeOf<number>();
  expectTypeOf<ReturnType<typeof _dateCodec.decode>>().toEqualTypeOf<Date>();
});

test('codec() preserves wire type (TWire)', () => {
  // biome-ignore lint/correctness/noUnusedVariables: variable used for type checking
  const _stringCodec = codec<'test/string@1', string, string>({
    typeId: 'test/string@1',
    targetTypes: ['string'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  // biome-ignore lint/correctness/noUnusedVariables: variable used for type checking
  const _dateCodec = codec<'test/date@1', string, Date>({
    typeId: 'test/date@1',
    targetTypes: ['date'],
    encode: (value: Date): string => value.toISOString(),
    decode: (wire: string): Date => new Date(wire),
  });

  // Verify wire types are preserved (encode is optional, so we check NonNullable)
  expectTypeOf<ReturnType<NonNullable<typeof _stringCodec.encode>>>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<typeof _stringCodec.decode>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<NonNullable<typeof _dateCodec.encode>>>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<typeof _dateCodec.decode>[0]>().toEqualTypeOf<string>();
});
