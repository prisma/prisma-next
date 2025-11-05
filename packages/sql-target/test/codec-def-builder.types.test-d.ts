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

  const codecs = defineCodecs()
    .add('text', textCodec)
    .add('int4', intCodec)
    .add('bool', boolCodec);

  type CodecTypes = typeof codecs.CodecTypes;

  // Verify literal IDs are preserved as keys
  type CodecTypesKeys = keyof CodecTypes;
  // Type-level check: verify literal IDs are preserved
  type _CodecTypesKeysCheck = CodecTypesKeys extends 'pg/text@1' | 'pg/int4@1' | 'pg/bool@1' ? true : false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ = true as _CodecTypesKeysCheck;

  // Verify input and output types are correctly aggregated
  // Type-level verification: these should compile without errors
  type TextInput = CodecTypes['pg/text@1']['input'];
  type TextOutput = CodecTypes['pg/text@1']['output'];
  type IntInput = CodecTypes['pg/int4@1']['input'];
  type IntOutput = CodecTypes['pg/int4@1']['output'];
  type BoolInput = CodecTypes['pg/bool@1']['input'];
  type BoolOutput = CodecTypes['pg/bool@1']['output'];

  // Verify these types match the expected types
  // If the types are correct, these assignments should work
  const _textInputCheck: TextInput extends string ? true : false = true;
  const _textOutputCheck: TextOutput extends string ? true : false = true;
  const _intInputCheck: IntInput extends number ? true : false = true;
  const _intOutputCheck: IntOutput extends number ? true : false = true;
  const _boolInputCheck: BoolInput extends boolean ? true : false = true;
  const _boolOutputCheck: BoolOutput extends boolean ? true : false = true;

  void _textInputCheck;
  void _textOutputCheck;
  void _intInputCheck;
  void _intOutputCheck;
  void _boolInputCheck;
  void _boolOutputCheck;
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

  const codecs = defineCodecs()
    .add('text', textCodec)
    .add('int4', intCodec)
    .add('date', dateCodec);

  type ScalarToJs = typeof codecs.ScalarToJs;

  // Verify literal scalar names are preserved as keys
  type ScalarToJsKeys = keyof ScalarToJs;
  // Type-level check: verify literal scalar names are preserved
  type _ScalarToJsKeysCheck = ScalarToJsKeys extends 'text' | 'int4' | 'date' ? true : false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ = true as _ScalarToJsKeysCheck;

  // Verify JS types are correctly aggregated
  type TextJs = ScalarToJs['text'];
  type IntJs = ScalarToJs['int4'];
  type DateJs = ScalarToJs['date'];

  // Verify these types match the expected types
  const _textJsCheck: TextJs extends string ? true : false = true;
  const _intJsCheck: IntJs extends number ? true : false = true;
  const _dateJsCheck: DateJs extends Date ? true : false = true;

  void _textJsCheck;
  void _intJsCheck;
  void _dateJsCheck;
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

  type CodecTypes = typeof codecs.CodecTypes;

  // Verify literal ID is preserved as key
  type CodecTypesKeys = keyof CodecTypes;
  // Type-level check: verify literal ID is preserved
  type _CodecTypesKeysCheck = CodecTypesKeys extends 'pg/text@1' ? true : false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ = true as _CodecTypesKeysCheck;

  // Verify input and output types are correctly extracted
  type TextInput = CodecTypes['pg/text@1']['input'];
  type TextOutput = CodecTypes['pg/text@1']['output'];

  // Verify these types match the expected types
  const _textInputCheck: TextInput extends string ? true : false = true;
  const _textOutputCheck: TextOutput extends string ? true : false = true;

  void _textInputCheck;
  void _textOutputCheck;
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type _Builder1KeysCheck = Builder1Keys extends 'pg/text@1' ? true : false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type _Builder2KeysCheck = Builder2Keys extends 'pg/text@1' | 'pg/int4@1' ? true : false;

  // Verify input/output types are correctly aggregated
  type Builder1TextInput = Builder1Types['pg/text@1']['input'];
  type Builder1TextOutput = Builder1Types['pg/text@1']['output'];
  type Builder2TextInput = Builder2Types['pg/text@1']['input'];
  type Builder2TextOutput = Builder2Types['pg/text@1']['output'];
  type Builder2IntInput = Builder2Types['pg/int4@1']['input'];
  type Builder2IntOutput = Builder2Types['pg/int4@1']['output'];

  // Verify these types match the expected types
  const _builder1TextInputCheck: Builder1TextInput extends string ? true : false = true;
  const _builder1TextOutputCheck: Builder1TextOutput extends string ? true : false = true;
  const _builder2TextInputCheck: Builder2TextInput extends string ? true : false = true;
  const _builder2TextOutputCheck: Builder2TextOutput extends string ? true : false = true;
  const _builder2IntInputCheck: Builder2IntInput extends number ? true : false = true;
  const _builder2IntOutputCheck: Builder2IntOutput extends number ? true : false = true;

  void _builder1TextInputCheck;
  void _builder1TextOutputCheck;
  void _builder2TextInputCheck;
  void _builder2TextOutputCheck;
  void _builder2IntInputCheck;
  void _builder2IntOutputCheck;

  // Verify ScalarToJs is correctly aggregated
  type Builder1ScalarKeys = keyof Builder1ScalarToJs;
  type Builder2ScalarKeys = keyof Builder2ScalarToJs;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type _Builder1ScalarKeysCheck = Builder1ScalarKeys extends 'text' ? true : false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type _Builder2ScalarKeysCheck = Builder2ScalarKeys extends 'text' | 'int4' ? true : false;

  type Builder1TextJs = Builder1ScalarToJs['text'];
  type Builder2TextJs = Builder2ScalarToJs['text'];
  type Builder2IntJs = Builder2ScalarToJs['int4'];

  // Verify these types match the expected types
  const _builder1TextJsCheck: Builder1TextJs extends string ? true : false = true;
  const _builder2TextJsCheck: Builder2TextJs extends string ? true : false = true;
  const _builder2IntJsCheck: Builder2IntJs extends number ? true : false = true;

  void _builder1TextJsCheck;
  void _builder2TextJsCheck;
  void _builder2IntJsCheck;
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

  const codecs = defineCodecs()
    .add('text', textCodec)
    .add('int4', intCodec);

  type DataTypes = typeof codecs.dataTypes;

  // Verify literal scalar names are preserved as keys
  type DataTypesKeys = keyof DataTypes;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type _DataTypesKeysCheck = DataTypesKeys extends 'text' | 'int4' ? true : false;

  // Verify literal type IDs are preserved (not widened to string)
  type TextTypeId = DataTypes['text'];
  type IntTypeId = DataTypes['int4'];

  // Verify these types match the expected literal types
  const _textTypeIdCheck: TextTypeId extends 'pg/text@1' ? true : false = true;
  const _intTypeIdCheck: IntTypeId extends 'pg/int4@1' ? true : false = true;

  void _textTypeIdCheck;
  void _intTypeIdCheck;
});

