import type { FieldOutputType } from '../src/contract-types';
import type { FixtureDefinition, ProductOutput, VectorN } from './fixtures/codec-resolver-fixture';

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<_T extends true> = never;

// ── AC-2.a: inline `vector(1536)` column resolves to `VectorN<1536>` ──────
export type _InlineVector = Assert<
  IsEqual<FieldOutputType<FixtureDefinition, 'Inline', 'embedding'>, VectorN<1536>>
>;

// ── AC-2.b: literal `1536` is preserved (not widened to `number`) ─────────
export type _RejectsWidenedLiteral = Assert<
  IsEqual<
    IsEqual<FieldOutputType<FixtureDefinition, 'Inline', 'embedding'>, VectorN<number>>,
    false
  >
>;

// ── AC-2.c: JSON column with a Standard-Schema schema infers its output ───
export type _InlineJson = Assert<
  IsEqual<FieldOutputType<FixtureDefinition, 'Inline', 'product'>, ProductOutput>
>;

// ── AC-2: CipherStash-shaped factory resolves through `Js` ────────────────
export type _InlineCipherStash = Assert<
  IsEqual<FieldOutputType<FixtureDefinition, 'Inline', 'secret'>, string>
>;

// ── AC-2.d: non-parameterized column falls through to codec base output ──
export type _NonParameterizedFallback = Assert<
  IsEqual<FieldOutputType<FixtureDefinition, 'Inline', 'id'>, number>
>;

// ── AC-2.e: nullable inline parameterized column resolves to `Js | null` ──
export type _NullableInlineVector = Assert<
  IsEqual<FieldOutputType<FixtureDefinition, 'Inline', 'nullableEmbedding'>, VectorN<1536> | null>
>;

// ── AC-2.f: typeRef column resolves through `storage.types` to the same Js ─
export type _TypeRefVector = Assert<
  IsEqual<FieldOutputType<FixtureDefinition, 'Named', 'embedding'>, VectorN<1536>>
>;

// ── AC-2.g: nullable typeRef column resolves to `Js | null` ───────────────
export type _NullableTypeRefVector = Assert<
  IsEqual<FieldOutputType<FixtureDefinition, 'Named', 'nullableEmbedding'>, VectorN<1536> | null>
>;

// ── AC-2: typeRef column whose `storage.types` entry has no factory falls
//         through to the codec registry's base `output`. ─────────────────
export type _TypeRefNonParameterizedFallback = Assert<
  IsEqual<FieldOutputType<FixtureDefinition, 'Named', 'counter'>, number>
>;

// Negative test: a parameterized column does NOT resolve to its codec's base
// output. If `FieldOutputType` ever regresses to the M1 behavior of reading
// `output` for parameterized columns, the `@ts-expect-error` line below stops
// failing and the whole file fails to typecheck.
type _Negative = FieldOutputType<FixtureDefinition, 'Inline', 'embedding'>;
// @ts-expect-error parameterized resolution must not collapse to `readonly number[]`.
type _Reject_NarrowingFailed = Assert<IsEqual<_Negative, readonly number[]>>;
