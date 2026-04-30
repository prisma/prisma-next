import type { CodecCallContext } from '@prisma-next/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import type { Codec, SqlCodecCallContext, SqlColumnRef } from '../../src/ast/codec-types';
import { codec } from '../../src/ast/codec-types';

test('SqlColumnRef shape is `{ table, name }`', () => {
  expectTypeOf<SqlColumnRef>().toEqualTypeOf<{
    readonly table: string;
    readonly name: string;
  }>();
});

test('SqlCodecCallContext extends framework CodecCallContext (signal) and adds column', () => {
  type Signal = NonNullable<SqlCodecCallContext['signal']>;
  expectTypeOf<Signal>().toEqualTypeOf<AbortSignal>();
  type Column = NonNullable<SqlCodecCallContext['column']>;
  expectTypeOf<Column>().toEqualTypeOf<SqlColumnRef>();
  // SqlCodecCallContext is assignable to CodecCallContext (extension).
  const sql: SqlCodecCallContext = { signal: new AbortController().signal };
  const fw: CodecCallContext = sql;
  void fw;
});

test('SQL Codec.encode/decode narrow ctx to SqlCodecCallContext', () => {
  type SqlCodec = Codec<'demo/x@1', readonly [], string, string>;
  type EncodeParams = Parameters<SqlCodec['encode']>;
  type DecodeParams = Parameters<SqlCodec['decode']>;
  expectTypeOf<EncodeParams[1]>().toEqualTypeOf<SqlCodecCallContext | undefined>();
  expectTypeOf<DecodeParams[1]>().toEqualTypeOf<SqlCodecCallContext | undefined>();
});

test('factory accepts a `(value, ctx: SqlCodecCallContext)` encode author', () => {
  const c = codec({
    typeId: 'demo/ctx-encode@1',
    targetTypes: ['text'],
    encode: (value: string, _ctx?: SqlCodecCallContext) => value,
    decode: (wire: string) => wire,
  });
  expectTypeOf(c.encode).toBeFunction();
  expectTypeOf<Parameters<typeof c.encode>[1]>().toEqualTypeOf<SqlCodecCallContext | undefined>();
});

test('factory accepts a `(value, ctx: SqlCodecCallContext)` decode author', () => {
  const c = codec({
    typeId: 'demo/ctx-decode@1',
    targetTypes: ['text'],
    encode: (value: string) => value,
    decode: (wire: string, _ctx?: SqlCodecCallContext) => wire,
  });
  expectTypeOf(c.decode).toBeFunction();
  expectTypeOf<Parameters<typeof c.decode>[1]>().toEqualTypeOf<SqlCodecCallContext | undefined>();
});

test('factory accepts a single-arg `(value)` encode author and exposes a Promise method', () => {
  const c = codec({
    typeId: 'demo/single-encode@1',
    targetTypes: ['text'],
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });
  expectTypeOf<ReturnType<typeof c.encode>>().toExtend<Promise<string>>();
});

test('factory lifts an async ctx-bearing encode into a Promise method', () => {
  const c = codec({
    typeId: 'demo/async-ctx-encode@1',
    targetTypes: ['text'],
    encode: async (value: string, _ctx?: SqlCodecCallContext) => value,
    decode: (wire: string) => wire,
  });
  expectTypeOf<ReturnType<typeof c.encode>>().toExtend<Promise<string>>();
});

test('factory preserves union-input TInput inference for `string | Date`-style authors', () => {
  // The union-arity author signatures (single- vs ctx-bearing) must not
  // collapse the author's authored input type. This regression-pins the
  // inference subtlety the m1 R1 union-arity fix unblocked: the
  // canonical `pg/timestamptz`-style codec authors `encode` as
  // `(value: string | Date) => string`, expects `TInput = string` from
  // `decode`'s return, and then `JsonRoundTripConfig<TInput>` keeps the
  // identity defaults legal.
  const c = codec({
    typeId: 'demo/union-input@1',
    targetTypes: ['text'],
    encode: (value: string | Date) => (typeof value === 'string' ? value : value.toISOString()),
    decode: (wire: string) => wire,
  });
  expectTypeOf<Parameters<typeof c.encode>[0]>().toExtend<string | Date>();
});
