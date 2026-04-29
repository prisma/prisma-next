import type { CodecCallContext } from '@prisma-next/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import { codec } from '../../src/ast/codec-types';

test('factory accepts a `(value, ctx)` encode author', () => {
  const c = codec({
    typeId: 'demo/ctx-encode@1',
    targetTypes: ['text'],
    encode: (value: string, _ctx?: CodecCallContext) => value,
    decode: (wire: string) => wire,
  });
  expectTypeOf(c.encode).toBeFunction();
  expectTypeOf<Parameters<NonNullable<typeof c.encode>>[1]>().toEqualTypeOf<
    CodecCallContext | undefined
  >();
});

test('factory accepts a `(value, ctx)` decode author', () => {
  const c = codec({
    typeId: 'demo/ctx-decode@1',
    targetTypes: ['text'],
    encode: (value: string) => value,
    decode: (wire: string, _ctx?: CodecCallContext) => wire,
  });
  expectTypeOf(c.decode).toBeFunction();
  expectTypeOf<Parameters<typeof c.decode>[1]>().toEqualTypeOf<CodecCallContext | undefined>();
});

test('factory accepts a single-arg `(value)` encode author and exposes a Promise method', () => {
  const c = codec({
    typeId: 'demo/single-encode@1',
    targetTypes: ['text'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });
  expectTypeOf<ReturnType<NonNullable<typeof c.encode>>>().toExtend<Promise<string>>();
});

test('factory lifts an async ctx-bearing encode into a Promise method', () => {
  const c = codec({
    typeId: 'demo/async-ctx-encode@1',
    targetTypes: ['text'],
    encode: async (value: string, _ctx?: CodecCallContext) => value,
    decode: (wire: string) => wire,
  });
  expectTypeOf<ReturnType<NonNullable<typeof c.encode>>>().toExtend<Promise<string>>();
});
