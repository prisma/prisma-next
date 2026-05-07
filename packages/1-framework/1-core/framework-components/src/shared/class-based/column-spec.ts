/**
 * `column()` packager + `ColumnHelperFor<D>` shapes — Pattern E.
 *
 * Trivial, non-polymorphic column packager. Generic over `R` (the codec
 * instance type returned by the descriptor's curried factory) and `P`
 * (the typeParams record). The framework does NOT try to infer `R` and
 * `P` from a descriptor — that path is the variance trap (see the
 * playground proof at `wip/m0-class-variance-proof.md`). Per-codec
 * helpers absorb the descriptor relationship instead and tie themselves
 * to their descriptor via `satisfies ColumnHelperFor<D>` /
 * `ColumnHelperForStrict<D>`.
 */

import type { CodecInstanceContext } from '../codec-types';
import type { CodecDescriptor } from './codec-descriptor';

/**
 * Structural mirror of `ColumnTypeDescriptor` from
 * `@prisma-next/contract-authoring`. Inlined here because
 * `framework-components` (layer 1 core) cannot depend on
 * `contract-authoring` (layer 2). `ColumnSpec<R, P>` keeps the same
 * shape so it remains assignable to `ColumnTypeDescriptor` at
 * consumer sites without an explicit `extends` clause.
 *
 * Per spec Q-2: this is the natural home of `column()`; the
 * `ColumnTypeDescriptor` shape compatibility is best expressed
 * structurally to avoid a layering violation.
 */
type ColumnTypeDescriptorShape = {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown>;
  readonly typeRef?: string;
};

/**
 * Class-based column spec. Extends {@link ColumnTypeDescriptor} so it
 * remains a drop-in for legacy contract authoring sites that consume
 * `ColumnTypeDescriptor` shapes.
 *
 * The `codecFactory` slot holds the curried factory the descriptor
 * returned (`(ctx) => R`); materialization is deferred until the
 * runtime supplies a `CodecInstanceContext`.
 */
export type ColumnSpec<R, P> = {
  readonly codecFactory: (ctx: CodecInstanceContext) => R;
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams: P;
  readonly typeRef?: string;
};

/**
 * Compile-time compatibility check: `ColumnSpec<R, P>` is structurally
 * compatible with the legacy `ColumnTypeDescriptor` shape (modulo
 * `typeParams` widening to `Record<string, unknown>`). Codec authors
 * pass `ColumnSpec` instances to contract authoring sites that consume
 * `ColumnTypeDescriptor` without an explicit `extends`.
 */
export type _ColumnSpecIsColumnTypeDescriptorCompatible<
  R,
  P extends Record<string, unknown> | undefined,
> = ColumnSpec<R, P> extends ColumnTypeDescriptorShape ? true : false;

/**
 * Trivial column packager. Per-codec helpers call this directly with
 * the result of `descriptor.factory(params)` — direct method invocation
 * binds the descriptor's method-level generic at the call site and the
 * literal flows through `R`.
 */
export function column<R, P>(
  codecFactory: (ctx: CodecInstanceContext) => R,
  codecId: string,
  typeParams: P,
): ColumnSpec<R, P> {
  return {
    codecFactory,
    codecId,
    typeParams,
    nativeType: codecId,
  };
}

/**
 * Coarse `satisfies` shape — checks the helper's typeParams record
 * matches the descriptor's factory params. Catches "wrong typeParams
 * shape" wiring mistakes; does NOT catch "wrong descriptor's factory"
 * mistakes (the codec slot is left as `unknown`).
 *
 * Use when the codec's `ReturnType<factory>` is unstable (e.g. heavily
 * overloaded factories where extraction widens too much).
 */
// biome-ignore lint/suspicious/noExplicitAny: variance erasure — `CodecDescriptor<P>` is invariant in P, so concrete subclasses do not extend `CodecDescriptor<unknown>`; matches the existing `AnyCodecDescriptor` pattern in `codec-types.ts`
export type ColumnHelperFor<D extends CodecDescriptor<any>> = (
  // biome-ignore lint/suspicious/noExplicitAny: helper signature is the verification subject; satisfies clauses can't narrow this without circular inference
  ...args: any[]
) => ColumnSpec<unknown, Parameters<D['factory']>[0]>;

/**
 * Strict `satisfies` shape — also checks the helper's codec is at
 * least the *base* codec instance type the descriptor's factory
 * returns. `ReturnType<ReturnType<D['factory']>>` widens method
 * generics to their constraint, so this only sanity-checks the wiring
 * at the base type level. Literal preservation comes from the direct
 * `descriptor.factory(...)` call inside the helper, not from
 * `satisfies`.
 */
// biome-ignore lint/suspicious/noExplicitAny: variance erasure — `CodecDescriptor<P>` is invariant in P, so concrete subclasses do not extend `CodecDescriptor<unknown>`; matches the existing `AnyCodecDescriptor` pattern in `codec-types.ts`
export type ColumnHelperForStrict<D extends CodecDescriptor<any>> = (
  // biome-ignore lint/suspicious/noExplicitAny: helper signature is the verification subject; satisfies clauses can't narrow this without circular inference
  ...args: any[]
) => ColumnSpec<ReturnType<ReturnType<D['factory']>>, Parameters<D['factory']>[0]>;
