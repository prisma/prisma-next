import { expectTypeOf, test } from 'vitest';
import { codec, defineCodecs } from '../src/codecs';

test('CodecTypes structure matches expected types', () => {
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

  expectTypeOf<CodecTypes>().toHaveProperty('pg/text@1');
  expectTypeOf<CodecTypes>().toHaveProperty('pg/int4@1');
  expectTypeOf<CodecTypes>().toHaveProperty('pg/bool@1');

  expectTypeOf<CodecTypes['pg/text@1']>().toHaveProperty('input');
  expectTypeOf<CodecTypes['pg/text@1']>().toHaveProperty('output');
  expectTypeOf<CodecTypes['pg/int4@1']>().toHaveProperty('input');
  expectTypeOf<CodecTypes['pg/int4@1']>().toHaveProperty('output');
  expectTypeOf<CodecTypes['pg/bool@1']>().toHaveProperty('input');
  expectTypeOf<CodecTypes['pg/bool@1']>().toHaveProperty('output');
});

test('ScalarToJs structure matches expected types', () => {
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

  type ScalarToJs = typeof codecs.ScalarToJs;

  expectTypeOf<ScalarToJs>().toHaveProperty('text');
  expectTypeOf<ScalarToJs>().toHaveProperty('int4');
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

  expectTypeOf<CodecTypes>().toHaveProperty('pg/text@1');
  expectTypeOf<CodecTypes['pg/text@1']>().toHaveProperty('input');
  expectTypeOf<CodecTypes['pg/text@1']>().toHaveProperty('output');
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

test('builder chain preserves literal types', () => {
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

  expectTypeOf<Builder1Types>().toHaveProperty('pg/text@1');
  expectTypeOf<Builder2Types>().toHaveProperty('pg/text@1');
  expectTypeOf<Builder2Types>().toHaveProperty('pg/int4@1');
});

test('dataTypes preserves literal type IDs', () => {
  const textCodec = codec<'pg/text@1', string, string>({
    typeId: 'pg/text@1',
    targetTypes: ['text'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  const codecs = defineCodecs().add('text', textCodec);

  // Type check: verify literal type is preserved
  expectTypeOf<typeof codecs.dataTypes>().toHaveProperty('text');
});

