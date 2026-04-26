import type { JsonValue } from '@prisma-next/contract/types';
import { expectTypeOf, test } from 'vitest';
import type { Codec, CodecTrait } from '../src/codec-types';

test('encode is required and Promise-returning', () => {
  expectTypeOf<Codec>().toHaveProperty('encode');
  expectTypeOf<Codec['encode']>().toBeFunction();
  type EncodeReturn = ReturnType<NonNullable<Codec['encode']>>;
  expectTypeOf<EncodeReturn>().toExtend<Promise<unknown>>();
});

test('decode is required and Promise-returning', () => {
  expectTypeOf<Codec>().toHaveProperty('decode');
  expectTypeOf<Codec['decode']>().toBeFunction();
  type DecodeReturn = ReturnType<Codec['decode']>;
  expectTypeOf<DecodeReturn>().toExtend<Promise<unknown>>();
});

test('encodeJson is required and synchronous', () => {
  expectTypeOf<Codec>().toHaveProperty('encodeJson');
  expectTypeOf<Codec['encodeJson']>().toBeFunction();
  type EncodeJsonReturn = ReturnType<Codec['encodeJson']>;
  expectTypeOf<EncodeJsonReturn>().toEqualTypeOf<JsonValue>();
});

test('decodeJson is required and synchronous', () => {
  expectTypeOf<Codec>().toHaveProperty('decodeJson');
  expectTypeOf<Codec['decodeJson']>().toBeFunction();
  type DecodeJsonReturn = ReturnType<Codec['decodeJson']>;
  // synchronous: not a Promise
  expectTypeOf<DecodeJsonReturn>().not.toExtend<Promise<unknown>>();
});

test('renderOutputType is optional and synchronous', () => {
  type Render = NonNullable<Codec['renderOutputType']>;
  expectTypeOf<Render>().toBeFunction();
  expectTypeOf<ReturnType<Render>>().toEqualTypeOf<string | undefined>();
  // optional on the interface
  type IsOptional = undefined extends Codec['renderOutputType'] ? true : false;
  expectTypeOf<IsOptional>().toEqualTypeOf<true>();
});

test('Codec carries no async marker (no runtime/kind/TRuntime fields)', () => {
  type CodecKeys = keyof Codec;
  const expectedKeys = [
    'id',
    'targetTypes',
    'traits',
    'encode',
    'decode',
    'encodeJson',
    'decodeJson',
    'renderOutputType',
  ] as const;
  type ExpectedKeys = (typeof expectedKeys)[number];
  expectTypeOf<CodecKeys>().toEqualTypeOf<ExpectedKeys>();
});

test('Codec input/output may differ via TInput/TOutput', () => {
  type StringToNumberCodec = Codec<'demo/in-out@1', readonly CodecTrait[], string, string, number>;
  expectTypeOf<ReturnType<StringToNumberCodec['encode']>>().toExtend<Promise<string>>();
  expectTypeOf<ReturnType<StringToNumberCodec['decode']>>().toExtend<Promise<number>>();
  expectTypeOf<Parameters<StringToNumberCodec['encode']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<StringToNumberCodec['decode']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<StringToNumberCodec['encodeJson']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<StringToNumberCodec['decodeJson']>>().toEqualTypeOf<string>();
});

test('TOutput defaults to TInput when omitted', () => {
  type FourArgCodec = Codec<'demo/identity@1', readonly CodecTrait[], string, number>;
  expectTypeOf<ReturnType<FourArgCodec['decode']>>().toExtend<Promise<number>>();
  expectTypeOf<Parameters<FourArgCodec['encode']>[0]>().toEqualTypeOf<number>();
});
