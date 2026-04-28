import { expectTypeOf, test } from 'vitest';
import { codec } from '../../src/ast/codec-types';

test('factory accepts sync encode and decode and produces Promise-returning methods', () => {
  const c = codec({
    typeId: 'demo/sync@1',
    targetTypes: ['text'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  expectTypeOf(c.encode).toBeFunction();
  expectTypeOf(c.decode).toBeFunction();
  expectTypeOf<ReturnType<NonNullable<typeof c.encode>>>().toExtend<Promise<string>>();
  expectTypeOf<ReturnType<typeof c.decode>>().toExtend<Promise<string>>();
});

test('factory accepts async encode and decode', () => {
  const c = codec({
    typeId: 'demo/async@1',
    targetTypes: ['text'],
    encode: async (value: string) => value,
    decode: async (wire: string) => wire,
  });

  expectTypeOf<ReturnType<NonNullable<typeof c.encode>>>().toExtend<Promise<string>>();
  expectTypeOf<ReturnType<typeof c.decode>>().toExtend<Promise<string>>();
});

test('factory accepts mixed sync encode + async decode', () => {
  const c = codec({
    typeId: 'demo/mixed-a@1',
    targetTypes: ['text'],
    encode: (value: string) => value,
    decode: async (wire: string) => wire,
  });

  expectTypeOf<ReturnType<NonNullable<typeof c.encode>>>().toExtend<Promise<string>>();
  expectTypeOf<ReturnType<typeof c.decode>>().toExtend<Promise<string>>();
});

test('factory accepts mixed async encode + sync decode', () => {
  const c = codec({
    typeId: 'demo/mixed-b@1',
    targetTypes: ['text'],
    encode: async (value: string) => value,
    decode: (wire: string) => wire,
  });

  expectTypeOf<ReturnType<NonNullable<typeof c.encode>>>().toExtend<Promise<string>>();
  expectTypeOf<ReturnType<typeof c.decode>>().toExtend<Promise<string>>();
});

test('factory installs identity encode default when encode is omitted', () => {
  const c = codec({
    typeId: 'demo/no-encode@1',
    targetTypes: ['text'],
    decode: (wire: string) => wire,
  });

  expectTypeOf(c.encode).toBeFunction();
  expectTypeOf<ReturnType<NonNullable<typeof c.encode>>>().toExtend<Promise<unknown>>();
});

test('factory passes encodeJson and decodeJson through as synchronous', () => {
  const c = codec({
    typeId: 'demo/json@1',
    targetTypes: ['text'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
    encodeJson: (value: string) => value,
    decodeJson: (json) => json as string,
  });

  expectTypeOf<ReturnType<typeof c.encodeJson>>().not.toExtend<Promise<unknown>>();
  expectTypeOf<ReturnType<typeof c.decodeJson>>().not.toExtend<Promise<unknown>>();
});
