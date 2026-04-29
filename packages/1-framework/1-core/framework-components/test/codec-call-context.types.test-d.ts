import { expectTypeOf, test } from 'vitest';
import type { Codec, CodecCallContext } from '../src/codec-types';

test('CodecCallContext is the shared per-call context shape', () => {
  type Signal = NonNullable<CodecCallContext['signal']>;
  expectTypeOf<Signal>().toEqualTypeOf<AbortSignal>();
  type Column = NonNullable<CodecCallContext['column']>;
  expectTypeOf<Column>().toEqualTypeOf<{
    readonly table: string;
    readonly name: string;
  }>();
});

test('CodecCallContext has exactly two optional fields (signal, column)', () => {
  type Keys = keyof CodecCallContext;
  expectTypeOf<Keys>().toEqualTypeOf<'signal' | 'column'>();
  type SignalIsOptional = undefined extends CodecCallContext['signal'] ? true : false;
  type ColumnIsOptional = undefined extends CodecCallContext['column'] ? true : false;
  expectTypeOf<SignalIsOptional>().toEqualTypeOf<true>();
  expectTypeOf<ColumnIsOptional>().toEqualTypeOf<true>();
});

test('Codec.encode accepts an optional CodecCallContext as a second argument', () => {
  type EncodeParams = Parameters<Codec<'demo/x@1', readonly [], string, string>['encode']>;
  expectTypeOf<EncodeParams[0]>().toEqualTypeOf<string>();
  expectTypeOf<EncodeParams[1]>().toEqualTypeOf<CodecCallContext | undefined>();
});

test('Codec.decode accepts an optional CodecCallContext as a second argument', () => {
  type DecodeParams = Parameters<Codec<'demo/x@1', readonly [], string, string>['decode']>;
  expectTypeOf<DecodeParams[0]>().toEqualTypeOf<string>();
  expectTypeOf<DecodeParams[1]>().toEqualTypeOf<CodecCallContext | undefined>();
});

test('single-arg encode/decode call sites still typecheck (additive arg)', () => {
  type StringCodec = Codec<'demo/text@1', readonly [], string, string>;
  // The codec interface only declares the method signature; we exercise it
  // here by asserting the call shape compiles for both arities.
  const encodeNoCtx = (c: StringCodec, v: string): Promise<string> => c.encode(v);
  const encodeWithCtx = (c: StringCodec, v: string, ctx: CodecCallContext): Promise<string> =>
    c.encode(v, ctx);
  const decodeNoCtx = (c: StringCodec, w: string): Promise<string> => c.decode(w);
  const decodeWithCtx = (c: StringCodec, w: string, ctx: CodecCallContext): Promise<string> =>
    c.decode(w, ctx);
  void encodeNoCtx;
  void encodeWithCtx;
  void decodeNoCtx;
  void decodeWithCtx;
});

// ADR 204 walk-back constraints — pinned here so future refactors cannot
// reintroduce a `TRuntime` generic, a discriminator field, conditional
// return types, or other shape complications on the public Codec.

test('Codec carries no `runtime` or `kind` discriminator field', () => {
  type CodecKeys = keyof Codec;
  expectTypeOf<CodecKeys>().not.toExtend<'runtime'>();
  expectTypeOf<CodecKeys>().not.toExtend<'kind'>();
});

test('Codec has exactly four type parameters (Id, TTraits, TWire, TInput) — no TRuntime', () => {
  // If a fifth `TRuntime` generic were added before TWire/TInput, this
  // call shape would either fail or produce an unrelated codec type.
  type FourGenericCodec = Codec<'demo/four@1', readonly [], number, string>;
  expectTypeOf<Parameters<FourGenericCodec['encode']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<FourGenericCodec['encode']>>().toExtend<Promise<number>>();
});

test('encode return type is unconditionally Promise<TWire> (no conditional types)', () => {
  type CodecA = Codec<'demo/a@1', readonly [], string, string>;
  type CodecB = Codec<'demo/b@1', readonly [], number, number>;
  expectTypeOf<ReturnType<CodecA['encode']>>().toEqualTypeOf<Promise<string>>();
  expectTypeOf<ReturnType<CodecB['encode']>>().toEqualTypeOf<Promise<number>>();
});

test('decode return type is unconditionally Promise<TInput> (no conditional types)', () => {
  type CodecA = Codec<'demo/a@1', readonly [], string, string>;
  type CodecB = Codec<'demo/b@1', readonly [], number, number>;
  expectTypeOf<ReturnType<CodecA['decode']>>().toEqualTypeOf<Promise<string>>();
  expectTypeOf<ReturnType<CodecB['decode']>>().toEqualTypeOf<Promise<number>>();
});
