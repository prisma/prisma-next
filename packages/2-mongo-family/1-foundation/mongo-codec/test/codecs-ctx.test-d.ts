import type { CodecCallContext } from '@prisma-next/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import { mongoCodec } from '../src/codecs';

test('Mongo uses the framework CodecCallContext directly (signal-only, no `column`)', () => {
  type Keys = keyof CodecCallContext;
  expectTypeOf<Keys>().toEqualTypeOf<'signal'>();
  expectTypeOf<Keys>().not.toExtend<'column'>();
});

test('mongoCodec() accepts a `(value, ctx)` encode author', () => {
  const c = mongoCodec({
    typeId: 'demo/ctx-encode@1',
    targetTypes: ['string'],
    encode: (value: string, _ctx?: CodecCallContext) => value,
    decode: (wire: string) => wire,
  });
  expectTypeOf(c.encode).toBeFunction();
  expectTypeOf<Parameters<typeof c.encode>[1]>().toEqualTypeOf<CodecCallContext | undefined>();
});

test('mongoCodec() accepts a `(value, ctx)` decode author', () => {
  const c = mongoCodec({
    typeId: 'demo/ctx-decode@1',
    targetTypes: ['string'],
    encode: (value: string) => value,
    decode: (wire: string, _ctx?: CodecCallContext) => wire,
  });
  expectTypeOf<Parameters<typeof c.decode>[1]>().toEqualTypeOf<CodecCallContext | undefined>();
});

test('mongoCodec() accepts a single-arg `(value)` encode author and exposes a Promise method', () => {
  const c = mongoCodec({
    typeId: 'demo/single-encode@1',
    targetTypes: ['string'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });
  expectTypeOf<ReturnType<typeof c.encode>>().toExtend<Promise<string>>();
});
