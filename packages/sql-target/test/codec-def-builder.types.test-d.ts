import { expectTypeOf, test } from 'vitest';
import { codec, defineCodecs } from '../src/codecs';

test('CodecTypes structure matches expected types with correct literal IDs', () => {
  const textCodec = codec<'pg/text@1', string, string>({
    typeId: 'pg/text@1',
    targetTypes: ['text'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  const intCodec = codec<'pg/int4@1', number, number>({
    typeId: 'pg/int4@1',
    targetTypes: ['int4'],
    encode: (value: number) => value,
    decode: (wire: number) => wire,
  });

  const boolCodec = codec<'pg/bool@1', boolean, boolean>({
    typeId: 'pg/bool@1',
    targetTypes: ['bool'],
    encode: (value: boolean) => value,
    decode: (wire: boolean) => wire,
  });

  const codecs = defineCodecs().add('text', textCodec).add('int4', intCodec).add('bool', boolCodec);

  // Verify literal IDs are preserved as keys
  expectTypeOf<keyof typeof codecs.CodecTypes>().toEqualTypeOf<
    'pg/text@1' | 'pg/int4@1' | 'pg/bool@1'
  >();

  // Verify input and output types are correctly aggregated
  expectTypeOf<(typeof codecs.CodecTypes)['pg/text@1']['input']>().toEqualTypeOf<string>();
  expectTypeOf<(typeof codecs.CodecTypes)['pg/text@1']['output']>().toEqualTypeOf<string>();
  expectTypeOf<(typeof codecs.CodecTypes)['pg/int4@1']['input']>().toEqualTypeOf<number>();
  expectTypeOf<(typeof codecs.CodecTypes)['pg/int4@1']['output']>().toEqualTypeOf<number>();
  expectTypeOf<(typeof codecs.CodecTypes)['pg/bool@1']['input']>().toEqualTypeOf<boolean>();
  expectTypeOf<(typeof codecs.CodecTypes)['pg/bool@1']['output']>().toEqualTypeOf<boolean>();
});

test('ScalarToJs structure matches expected types with correct JS types', () => {
  const textCodec = codec<'pg/text@1', string, string>({
    typeId: 'pg/text@1',
    targetTypes: ['text'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  const intCodec = codec<'pg/int4@1', number, number>({
    typeId: 'pg/int4@1',
    targetTypes: ['int4'],
    encode: (value: number) => value,
    decode: (wire: number) => wire,
  });

  const dateCodec = codec<'pg/date@1', string, Date>({
    typeId: 'pg/date@1',
    targetTypes: ['date'],
    encode: (value: Date): string => value.toISOString(),
    decode: (wire: string): Date => new Date(wire),
  });

  const codecs = defineCodecs().add('text', textCodec).add('int4', intCodec).add('date', dateCodec);

  // Verify literal scalar names are preserved as keys
  expectTypeOf<keyof typeof codecs.ScalarToJs>().toEqualTypeOf<'text' | 'int4' | 'date'>();

  // Verify JS types are correctly aggregated
  expectTypeOf<(typeof codecs.ScalarToJs)['text']>().toEqualTypeOf<string>();
  expectTypeOf<(typeof codecs.ScalarToJs)['int4']>().toEqualTypeOf<number>();
  expectTypeOf<(typeof codecs.ScalarToJs)['date']>().toEqualTypeOf<Date>();
});

test('literal types are preserved (not widened to string)', () => {
  const textCodec = codec<'pg/text@1', string, string>({
    typeId: 'pg/text@1',
    targetTypes: ['text'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  const codecs = defineCodecs().add('text', textCodec);

  type CodecTypes = typeof codecs.CodecTypes;
  type DataTypes = typeof codecs.dataTypes;

  // Type check: verify literal types are preserved
  expectTypeOf<CodecTypes>().toHaveProperty('pg/text@1');
  expectTypeOf<DataTypes>().toHaveProperty('text');
});

test('ExtractCodecTypes extracts correct types from builder', () => {
  const textCodec = codec<'pg/text@1', string, string>({
    typeId: 'pg/text@1',
    targetTypes: ['text'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  const codecs = defineCodecs().add('text', textCodec);

  // Verify literal ID is preserved as key
  expectTypeOf<keyof typeof codecs.CodecTypes>().toEqualTypeOf<'pg/text@1'>();

  // Verify input and output types are correctly extracted
  expectTypeOf<(typeof codecs.CodecTypes)['pg/text@1']['input']>().toEqualTypeOf<string>();
  expectTypeOf<(typeof codecs.CodecTypes)['pg/text@1']['output']>().toEqualTypeOf<string>();
});

test('ExtractScalarToJs extracts correct types from builder', () => {
  const textCodec = codec<'pg/text@1', string, string>({
    typeId: 'pg/text@1',
    targetTypes: ['text'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  const codecs = defineCodecs().add('text', textCodec);

  type ScalarToJs = typeof codecs.ScalarToJs;

  expectTypeOf<ScalarToJs>().toHaveProperty('text');
});

test('builder chain preserves literal types and aggregates correctly', () => {
  const textCodec = codec<'pg/text@1', string, string>({
    typeId: 'pg/text@1',
    targetTypes: ['text'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  const intCodec = codec<'pg/int4@1', number, number>({
    typeId: 'pg/int4@1',
    targetTypes: ['int4'],
    encode: (value: number) => value,
    decode: (wire: number) => wire,
  });

  const builder1 = defineCodecs().add('text', textCodec);
  const builder2 = builder1.add('int4', intCodec);

  type Builder1Types = typeof builder1.CodecTypes;
  type Builder2Types = typeof builder2.CodecTypes;
  type Builder1ScalarToJs = typeof builder1.ScalarToJs;
  type Builder2ScalarToJs = typeof builder2.ScalarToJs;

  // Verify literal IDs are preserved through chain
  type Builder1Keys = keyof Builder1Types;
  type Builder2Keys = keyof Builder2Types;
  expectTypeOf<Builder1Keys>().toEqualTypeOf<'pg/text@1'>();
  expectTypeOf<Builder2Keys>().toExtend<'pg/text@1' | 'pg/int4@1'>();
  expectTypeOf<'pg/text@1' | 'pg/int4@1'>().toExtend<Builder2Keys>();

  // Verify input/output types are correctly aggregated
  type Builder1TextInput = Builder1Types['pg/text@1']['input'];
  type Builder1TextOutput = Builder1Types['pg/text@1']['output'];
  type Builder2TextInput = Builder2Types['pg/text@1']['input'];
  type Builder2TextOutput = Builder2Types['pg/text@1']['output'];
  type Builder2IntInput = Builder2Types['pg/int4@1']['input'];
  type Builder2IntOutput = Builder2Types['pg/int4@1']['output'];

  // Verify these types match the expected types
  expectTypeOf<Builder1TextInput>().toExtend<string>();
  expectTypeOf<Builder1TextOutput>().toExtend<string>();
  expectTypeOf<Builder2TextInput>().toExtend<string>();
  expectTypeOf<Builder2TextOutput>().toExtend<string>();
  expectTypeOf<Builder2IntInput>().toExtend<number>();
  expectTypeOf<Builder2IntOutput>().toExtend<number>();

  // Verify ScalarToJs is correctly aggregated
  type Builder1ScalarKeys = keyof Builder1ScalarToJs;
  type Builder2ScalarKeys = keyof Builder2ScalarToJs;
  expectTypeOf<Builder1ScalarKeys>().toEqualTypeOf<'text'>();
  expectTypeOf<Builder2ScalarKeys>().toExtend<'text' | 'int4'>();
  expectTypeOf<'text' | 'int4'>().toExtend<Builder2ScalarKeys>();

  type Builder1TextJs = Builder1ScalarToJs['text'];
  type Builder2TextJs = Builder2ScalarToJs['text'];
  type Builder2IntJs = Builder2ScalarToJs['int4'];

  // Verify these types match the expected types
  expectTypeOf<Builder1TextJs>().toExtend<string>();
  expectTypeOf<Builder2TextJs>().toExtend<string>();
  expectTypeOf<Builder2IntJs>().toExtend<number>();
});

test('dataTypes preserves literal type IDs', () => {
  const textCodec = codec<'pg/text@1', string, string>({
    typeId: 'pg/text@1',
    targetTypes: ['text'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  const intCodec = codec<'pg/int4@1', number, number>({
    typeId: 'pg/int4@1',
    targetTypes: ['int4'],
    encode: (value: number) => value,
    decode: (wire: number) => wire,
  });

  const codecs = defineCodecs().add('text', textCodec).add('int4', intCodec);

  type DataTypes = typeof codecs.dataTypes;

  // Verify literal scalar names are preserved as keys
  type DataTypesKeys = keyof DataTypes;
  expectTypeOf<DataTypesKeys>().toExtend<'text' | 'int4'>();
  expectTypeOf<'text' | 'int4'>().toExtend<DataTypesKeys>();

  // Verify literal type IDs are preserved (not widened to string)
  expectTypeOf<DataTypes['text']>().toEqualTypeOf<'pg/text@1'>();
  expectTypeOf<DataTypes['int4']>().toEqualTypeOf<'pg/int4@1'>();
});
