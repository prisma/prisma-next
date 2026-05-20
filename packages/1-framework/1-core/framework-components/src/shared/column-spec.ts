/**
 * `column()` packager + `ColumnSpec<R, P, T>` shape + `ColumnHelperFor<D>` variants for tying per-codec column helpers to their descriptor.
 *
 * `ColumnSpec<R, P, T>` extends {@link ColumnTypeDescriptor} so it remains a drop-in for contract authoring sites that consume `ColumnTypeDescriptor` shapes — both types live at the framework-components layer so the `extends` clause is real (no structural mirror).
 *
 * `column()` is a trivial, non-polymorphic packager. Generic over `R` (the codec instance type returned by the descriptor's curried factory), `P` (the typeParams record), and `T` (the descriptor's `traits` tuple — surfaced so contract-authoring sites can read a column's traits at the static type level). The framework does NOT try to infer `R` and `P` from a descriptor — that path is the variance trap. Per-codec helpers absorb the descriptor relationship instead and tie themselves to their descriptor via `satisfies ColumnHelperFor<D>` or `satisfies ColumnHelperForStrict<D>`.
 */

import type { CodecDescriptor } from './codec-descriptor';
import type { CodecInstanceContext, CodecTrait } from './codec-types';

/**
 * Authored column-type descriptor — the data shape an authoring site (PSL or TypeScript builders) attaches to a column to identify its codec and its native database type.
 *
 * Lives at the framework-components layer alongside the codec types so codec-author packages (e.g. column-spec / `column()` packagers) can extend it directly without crossing layer boundaries.
 *
 * @template TCodecId Narrowed codec id literal for sites that thread a specific codec id through the type system.
 */
export type ColumnTypeDescriptor<TCodecId extends string = string> = {
  readonly codecId: TCodecId;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown> | undefined;
  readonly typeRef?: string;
};

/**
 * Column spec carrying the codec factory closure alongside the {@link ColumnTypeDescriptor} fields. Codec authors return a `ColumnSpec` from per-codec column helpers; the runtime materializes the codec instance by calling `codecFactory(ctx)` once it knows the column's `CodecInstanceContext`.
 *
 * Extends {@link ColumnTypeDescriptor} so `ColumnSpec` instances flow directly into contract-authoring sites that consume the descriptor shape — no structural mirroring required.
 *
 * @template T The codec descriptor's `traits` tuple, surfaced at the static type level so contract-authoring sites (e.g. the SQL DSL's `.default(autoincrement())` gate) can read the literal traits a column carries. Per-codec helpers thread their descriptor's `traits` through this slot; helpers that omit traits collapse to `undefined` and consumers fall back to a no-traits behaviour.
 */
export interface ColumnSpec<
  R,
  P extends Record<string, unknown> | undefined,
  T extends readonly CodecTrait[] | undefined = undefined,
> extends ColumnTypeDescriptor {
  readonly codecFactory: (ctx: CodecInstanceContext) => R;
  readonly typeParams: P;
  readonly traits: T;
}

/**
 * Trivial column packager. Per-codec helpers call this directly with the result of `descriptor.factory(params)` — direct method invocation binds the descriptor's method-level generic at the call site and the literal flows through `R`.
 *
 * `nativeType` is the column's database-native type spelling — the value the postgres adapter's migration planner, the SQL renderer's cast policy, and the contract's `meta.db.<family>.<target>.nativeType` slot read. Per-codec helpers pass the literal native-type string for their codec (e.g. `'text'`, `'int4'`, `'character varying'`); for codecs whose native-type spelling depends on parameters (none today; reserved for future shapes), the helper computes the rendered string before calling `column`. The framework does not derive the value from `codecId` — that mapping is target-specific and lives at the helper.
 *
 * `traits` is the descriptor's `traits` tuple, threaded through `ColumnSpec`'s static type so trait-gated authoring (e.g. `.default(autoincrement())`) reads it at compile time. Helpers that omit `traits` produce a spec with `traits: undefined` — consumers fall back to a no-traits behaviour. Per-codec helpers pass `descriptor.traits` directly so the literal tuple flows into `T`.
 */
export function column<
  R,
  P extends Record<string, unknown> | undefined,
  const T extends readonly CodecTrait[] | undefined = undefined,
>(
  codecFactory: (ctx: CodecInstanceContext) => R,
  codecId: string,
  typeParams: P,
  nativeType: string,
  traits?: T,
): ColumnSpec<R, P, T> {
  return {
    codecFactory,
    codecId,
    typeParams,
    nativeType,
    traits: traits as T,
  };
}

/**
 * Coarse `satisfies` shape — checks the helper's typeParams record matches the descriptor's factory params. Catches "wrong typeParams shape" wiring mistakes; does NOT catch "wrong descriptor's factory" mistakes (the codec slot is left as `unknown`).
 *
 * Use when the codec's `ReturnType<factory>` is unstable (e.g. heavily overloaded factories where extraction widens too much).
 *
 * The traits slot is left as `readonly CodecTrait[] | undefined` so per-codec helpers can thread their literal traits tuple through without the satisfies check rejecting them.
 */
// biome-ignore lint/suspicious/noExplicitAny: variance erasure — `CodecDescriptor<P>` is invariant in P, so concrete subclasses do not extend `CodecDescriptor<unknown>`; matches the existing `AnyCodecDescriptor` pattern
export type ColumnHelperFor<D extends CodecDescriptor<any>> = (
  // biome-ignore lint/suspicious/noExplicitAny: helper signature is the verification subject; satisfies clauses can't narrow this without circular inference
  ...args: any[]
) => ColumnSpec<unknown, ColumnHelperParams<D>, readonly CodecTrait[] | undefined>;

/**
 * Strict `satisfies` shape — also checks the helper's codec is at least the *base* codec instance type the descriptor's factory returns. `ReturnType<ReturnType<D['factory']>>` widens method generics to their constraint, so this only sanity-checks the wiring at the base type level. Literal preservation comes from the direct `descriptor.factory(...)` call inside the helper, not from `satisfies`.
 *
 * Traits slot widened to `readonly CodecTrait[] | undefined` for the same reason as the coarse variant.
 */
// biome-ignore lint/suspicious/noExplicitAny: variance erasure — `CodecDescriptor<P>` is invariant in P, so concrete subclasses do not extend `CodecDescriptor<unknown>`; matches the existing `AnyCodecDescriptor` pattern
export type ColumnHelperForStrict<D extends CodecDescriptor<any>> = (
  // biome-ignore lint/suspicious/noExplicitAny: helper signature is the verification subject; satisfies clauses can't narrow this without circular inference
  ...args: any[]
) => ColumnSpec<
  ReturnType<ReturnType<D['factory']>>,
  ColumnHelperParams<D>,
  readonly CodecTrait[] | undefined
>;

/**
 * Coerce a descriptor's `factory` first parameter into the typeParams shape `ColumnSpec` accepts. Non-parameterized descriptors (factory with no params, or `params: void`) collapse to `undefined`; parameterized descriptors keep the params record shape.
 */
// biome-ignore lint/suspicious/noExplicitAny: variance erasure — see above
type ColumnHelperParams<D extends CodecDescriptor<any>> =
  Parameters<D['factory']>[0] extends Record<string, unknown>
    ? Parameters<D['factory']>[0]
    : undefined;
