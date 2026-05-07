/**
 * Framework-level type tests for the class-based codec hierarchy +
 * `column()` packager + `ColumnHelperFor<D>` shapes (Pattern E).
 *
 * Uses inline fixture descriptors so the test is framework-internal
 * (no cross-package deps). Negative tests assert the variance discipline:
 * literal preservation through per-codec helpers' direct calls; satisfies
 * shape catches typeParams-shape and codec-wiring mistakes.
 *
 * Refs: TML-2357 M0 Phase A T0.A.3,
 * `projects/codec-registration-completion/specs/class-based-codec-design.spec.md`.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import { expectTypeOf, test } from 'vitest';
import {
  Codec,
  CodecDescriptor,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  type ColumnSpec,
  column,
} from '../src/exports/class-based-codec';
import type { CodecCallContext, CodecInstanceContext, CodecTrait } from '../src/shared/codec-types';
import { voidParamsSchema } from '../src/shared/codec-types';

// ---------------------------------------------------------------------------
// Inline fixture: non-parameterized codec (mirrors the spec's Case 1).
// ---------------------------------------------------------------------------

class Int4FixtureCodec extends Codec<'demo/int4@1', readonly ['equality'], number, number> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return wire;
  }
}

class Int4FixtureDescriptor extends CodecDescriptor<void> {
  override readonly codecId = 'demo/int4@1' as const;
  override readonly traits: readonly CodecTrait[] = ['equality'];
  override readonly targetTypes: readonly string[] = ['int4'];
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => Int4FixtureCodec {
    return () => new Int4FixtureCodec(this);
  }
}

const int4FixtureDescriptor = new Int4FixtureDescriptor();

const int4Fixture = () =>
  column(int4FixtureDescriptor.factory(), int4FixtureDescriptor.codecId, undefined);

int4Fixture satisfies ColumnHelperFor<Int4FixtureDescriptor>;
int4Fixture satisfies ColumnHelperForStrict<Int4FixtureDescriptor>;

// ---------------------------------------------------------------------------
// Inline fixture: parameterized codec with literal preservation
// (mirrors the spec's Case 2 — pgvector-shaped).
// ---------------------------------------------------------------------------

type VectorParams = { readonly length: number };
const vectorFixtureParamsSchema: StandardSchemaV1<VectorParams> = {
  '~standard': {
    version: 1,
    vendor: 'demo',
    validate: (input) => ({ value: input as VectorParams }),
  },
};

class VectorFixtureCodec<N extends number> extends Codec<
  'demo/vector@1',
  readonly ['equality'],
  string,
  number[]
> {
  constructor(
    descriptor: CodecDescriptor<VectorParams>,
    public readonly dimension: N,
  ) {
    super(descriptor);
  }
  async encode(value: number[], _ctx: CodecCallContext): Promise<string> {
    return `[${value.join(',')}]`;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<number[]> {
    return wire.slice(1, -1).split(',').map(Number);
  }
}

class VectorFixtureDescriptor extends CodecDescriptor<VectorParams> {
  override readonly codecId = 'demo/vector@1' as const;
  override readonly traits: readonly CodecTrait[] = ['equality'];
  override readonly targetTypes: readonly string[] = ['vector'];
  override readonly paramsSchema = vectorFixtureParamsSchema;
  override factory<N extends number>(params: {
    readonly length: N;
  }): (ctx: CodecInstanceContext) => VectorFixtureCodec<N> {
    return () => new VectorFixtureCodec<N>(this, params.length);
  }
}

const vectorFixtureDescriptor = new VectorFixtureDescriptor();

const vectorFixture = <N extends number>(length: N) =>
  column(vectorFixtureDescriptor.factory({ length }), vectorFixtureDescriptor.codecId, { length });

vectorFixture satisfies ColumnHelperFor<VectorFixtureDescriptor>;
vectorFixture satisfies ColumnHelperForStrict<VectorFixtureDescriptor>;

// ---------------------------------------------------------------------------
// AC-CB-2: literal preservation through direct invocation
// ---------------------------------------------------------------------------

test('descriptor factory call preserves method-level generic literal', () => {
  const factory = vectorFixtureDescriptor.factory({ length: 1536 });
  expectTypeOf(factory).toEqualTypeOf<(ctx: CodecInstanceContext) => VectorFixtureCodec<1536>>();
});

test('per-codec helper preserves literal through column packager', () => {
  const col = vectorFixture(1536);
  expectTypeOf(col.codecFactory).toEqualTypeOf<
    (ctx: CodecInstanceContext) => VectorFixtureCodec<1536>
  >();
  expectTypeOf(col.typeParams).toEqualTypeOf<{ length: 1536 }>();
});

test('non-parameterized helper packages void typeParams', () => {
  const col = int4Fixture();
  expectTypeOf(col.codecFactory).toEqualTypeOf<(ctx: CodecInstanceContext) => Int4FixtureCodec>();
  expectTypeOf(col.typeParams).toEqualTypeOf<undefined>();
});

test('ResolvedCodec extracts the typed codec from a column spec', () => {
  type ResolvedCodec<C> =
    C extends ColumnSpec<infer R, unknown>
      ? R
      : C extends { codecFactory: (ctx: CodecInstanceContext) => infer R }
        ? R
        : never;

  type EmbeddingResolved = ResolvedCodec<ReturnType<typeof vectorFixture<1536>>>;
  expectTypeOf<EmbeddingResolved>().toEqualTypeOf<VectorFixtureCodec<1536>>();
});

test('ColumnInputType extracts the codec TInput', () => {
  type ResolvedCodec<C> = C extends { codecFactory: (ctx: CodecInstanceContext) => infer R }
    ? R
    : never;
  type ColumnInputType<C> =
    ResolvedCodec<C> extends Codec<string, readonly CodecTrait[], unknown, infer T> ? T : never;

  expectTypeOf<ColumnInputType<ReturnType<typeof vectorFixture<1536>>>>().toEqualTypeOf<number[]>();
  expectTypeOf<ColumnInputType<ReturnType<typeof int4Fixture>>>().toEqualTypeOf<number>();
});

// ---------------------------------------------------------------------------
// AC-CB-3: satisfies discipline catches wiring mistakes
// ---------------------------------------------------------------------------

test('coarse satisfies catches wrong typeParams shape', () => {
  const brokenTypeParamsHelper = <N extends number>(length: N) =>
    column(vectorFixtureDescriptor.factory({ length }), vectorFixtureDescriptor.codecId, {
      wrongKey: length,
    });
  // @ts-expect-error -- typeParams shape doesn't satisfy ColumnHelperFor<VectorFixtureDescriptor> (missing `length`)
  brokenTypeParamsHelper satisfies ColumnHelperFor<VectorFixtureDescriptor>;
  // @ts-expect-error -- strict shape catches the same mismatch
  brokenTypeParamsHelper satisfies ColumnHelperForStrict<VectorFixtureDescriptor>;
});

test('strict satisfies catches wrong codec wired in', () => {
  // A helper that wires the int4 fixture's factory into VectorFixtureDescriptor's
  // codec id slot. Coarse satisfies passes (typeParams shape is correct);
  // strict satisfies fails because the codec types differ.
  const wrongCodecHelper = <N extends number>(length: N) =>
    column(int4FixtureDescriptor.factory(), vectorFixtureDescriptor.codecId, { length });
  wrongCodecHelper satisfies ColumnHelperFor<VectorFixtureDescriptor>;
  // @ts-expect-error -- codec is Int4FixtureCodec, not VectorFixtureCodec<number>
  wrongCodecHelper satisfies ColumnHelperForStrict<VectorFixtureDescriptor>;
});

// ---------------------------------------------------------------------------
// Heterogeneous-storage variance erasure
// ---------------------------------------------------------------------------

test('AnyCodecDescriptor stores parameterized + non-parameterized descriptors', () => {
  type AnyDesc = CodecDescriptor<unknown> | CodecDescriptor<VectorParams>;
  // The variance-erased CodecDescriptor<any> must be assignable from
  // both concrete descriptor classes for registry storage to work.
  const reg = new Map<string, CodecDescriptor<unknown>>();
  // Both assignments compile — the descriptor reference erases variance
  // when the registry's value type is `CodecDescriptor<unknown>`-shaped.
  reg.set(int4FixtureDescriptor.codecId, int4FixtureDescriptor);
  // Vector descriptor's TParams is non-void; it casts into the variance-
  // erased registry slot the same way `AnyCodecDescriptor` is the
  // canonical alias. We don't expose `as`-casts to consumers; the
  // registry reads back a typed value at retrieval time and narrows
  // through `instanceof` checks before calling `factory`.
  reg.set(vectorFixtureDescriptor.codecId, vectorFixtureDescriptor as CodecDescriptor<unknown>);
  expectTypeOf<typeof reg>().toMatchTypeOf<Map<string, AnyDesc>>();
});
