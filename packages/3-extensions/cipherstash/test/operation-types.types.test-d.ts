/**
 * Type-level acceptance tests for `QueryOperationTypes` in
 * `src/types/operation-types.ts`.
 *
 * Mirrors the framework's `OpMatchesField` predicate (defined in
 * `packages/3-extensions/sql-orm-client/src/types.ts`) inline so the
 * matching behaviour can be exercised against a synthetic
 * `CodecTypes` table without pulling in the full ORM model accessor.
 *
 * The tests pin two surface contracts:
 *
 *   1. **Codec-id dispatch (positive/negative)** for the legacy and
 *      single-codec entries (`cipherstashEq`, `cipherstashIlike`,
 *      `cipherstashNotIlike`, `cipherstashJsonbPathExists`):
 *      the operator must surface on its target codec id and on no
 *      other.
 *
 *   2. **Trait dispatch (positive/negative)** for the multi-codec
 *      entries (`cipherstashNe`, `cipherstashInArray`,
 *      `cipherstashNotInArray`, `cipherstashGt`, `cipherstashGte`,
 *      `cipherstashLt`, `cipherstashLte`, `cipherstashBetween`,
 *      `cipherstashNotBetween`): the operator must surface on every
 *      cipherstash codec whose trait set carries the gating trait
 *      and on no codec without it (notably `pg/text@1`, which is the
 *      regression-pinning negative case for the wrong-SQL `eq`
 *      footgun).
 *
 * AGENTS.md permits `@ts-expect-error` exclusively in negative
 * type-test files; this is one of them.
 */

import type { QueryOperationTypes } from '../src/types/operation-types';

// -- Synthetic CodecTypes table ----------------------------------------------
//
// Declares each cipherstash codec id under test with the traits its
// runtime descriptor advertises (per
// `extension-metadata/constants.ts:CIPHERSTASH_CODEC_TRAITS`). The
// trait identifiers use the `cipherstash:` namespace literally,
// matching the runtime widening of `descriptor.traits` to
// `readonly string[]` performed by the ORM model accessor.
//
// `pg/text@1` is included as the regression-pinning negative codec —
// it carries the framework's built-in `textual` / `equality` traits
// but none of the cipherstash-namespaced traits, so trait-dispatched
// cipherstash operators must NOT surface on it.

type CSEq = 'cipherstash:equality';
type CSOR = 'cipherstash:order-and-range';
type CSFTS = 'cipherstash:free-text-search';
type CSSJ = 'cipherstash:searchable-json';

type CT = {
  readonly 'cipherstash/string@1': {
    readonly input: string;
    readonly output: string;
    readonly traits: CSEq | CSOR | CSFTS;
  };
  readonly 'cipherstash/double@1': {
    readonly input: number;
    readonly output: number;
    readonly traits: CSEq | CSOR;
  };
  readonly 'cipherstash/bigint@1': {
    readonly input: bigint;
    readonly output: bigint;
    readonly traits: CSEq | CSOR;
  };
  readonly 'cipherstash/date@1': {
    readonly input: Date;
    readonly output: Date;
    readonly traits: CSEq | CSOR;
  };
  readonly 'cipherstash/boolean@1': {
    readonly input: boolean;
    readonly output: boolean;
    readonly traits: CSEq;
  };
  readonly 'cipherstash/json@1': {
    readonly input: unknown;
    readonly output: unknown;
    readonly traits: CSSJ;
  };
  readonly 'pg/text@1': {
    readonly input: string;
    readonly output: string;
    readonly traits: 'textual' | 'equality';
  };
  readonly 'pg/bool@1': {
    readonly input: boolean;
    readonly output: boolean;
    readonly traits: 'boolean';
  };
};

type Ops = QueryOperationTypes<CT>;

// -- Inline `OpMatchesField` (mirrors the framework definition) --------------

type OpMatchesField<Op, C extends string, Cct extends Record<string, unknown>> = Op extends {
  readonly self: infer Self;
}
  ? Self extends { readonly codecId: C }
    ? true
    : Self extends { readonly traits: infer R extends readonly string[] }
      ? C extends keyof Cct
        ? Cct[C] extends { readonly traits: infer FT }
          ? [R[number]] extends [FT]
            ? true
            : false
          : false
        : false
      : false
  : false;

type Expect<T extends true> = T;
type M<N extends keyof Ops, C extends string> = OpMatchesField<Ops[N], C, CT>;

// -- cipherstashEq (string only) --------------------------------------------

type _eq_string_pos = Expect<M<'cipherstashEq', 'cipherstash/string@1'>>;
// @ts-expect-error cipherstashEq must not surface on cipherstash/double@1.
type _eq_double_neg = Expect<M<'cipherstashEq', 'cipherstash/double@1'>>;
// @ts-expect-error cipherstashEq must not surface on pg/text@1.
type _eq_text_neg = Expect<M<'cipherstashEq', 'pg/text@1'>>;

// -- cipherstashIlike (string only) -----------------------------------------

type _ilike_string_pos = Expect<M<'cipherstashIlike', 'cipherstash/string@1'>>;
// @ts-expect-error cipherstashIlike must not surface on cipherstash/double@1.
type _ilike_double_neg = Expect<M<'cipherstashIlike', 'cipherstash/double@1'>>;

// -- cipherstashNotIlike (string only — single-codec dispatch) ---------------

type _notilike_string_pos = Expect<M<'cipherstashNotIlike', 'cipherstash/string@1'>>;
// @ts-expect-error cipherstashNotIlike must not surface on cipherstash/double@1.
type _notilike_double_neg = Expect<M<'cipherstashNotIlike', 'cipherstash/double@1'>>;
// @ts-expect-error cipherstashNotIlike must not surface on pg/text@1.
type _notilike_text_neg = Expect<M<'cipherstashNotIlike', 'pg/text@1'>>;

// -- cipherstashNe (equality trait — string/double/bigint/date/boolean) ------

type _ne_string_pos = Expect<M<'cipherstashNe', 'cipherstash/string@1'>>;
type _ne_double_pos = Expect<M<'cipherstashNe', 'cipherstash/double@1'>>;
type _ne_bigint_pos = Expect<M<'cipherstashNe', 'cipherstash/bigint@1'>>;
type _ne_date_pos = Expect<M<'cipherstashNe', 'cipherstash/date@1'>>;
type _ne_boolean_pos = Expect<M<'cipherstashNe', 'cipherstash/boolean@1'>>;
// @ts-expect-error cipherstashNe must not surface on cipherstash/json@1 (no equality trait).
type _ne_json_neg = Expect<M<'cipherstashNe', 'cipherstash/json@1'>>;
// @ts-expect-error regression: framework `equality` trait must not re-attach cipherstash ops on pg/text@1.
type _ne_text_neg = Expect<M<'cipherstashNe', 'pg/text@1'>>;

// -- cipherstashInArray (equality trait) ------------------------------------

type _ina_string_pos = Expect<M<'cipherstashInArray', 'cipherstash/string@1'>>;
type _ina_boolean_pos = Expect<M<'cipherstashInArray', 'cipherstash/boolean@1'>>;
// @ts-expect-error cipherstashInArray must not surface on cipherstash/json@1.
type _ina_json_neg = Expect<M<'cipherstashInArray', 'cipherstash/json@1'>>;
// @ts-expect-error cipherstashInArray must not surface on pg/text@1.
type _ina_text_neg = Expect<M<'cipherstashInArray', 'pg/text@1'>>;

// -- cipherstashNotInArray (equality trait) ---------------------------------

type _nina_double_pos = Expect<M<'cipherstashNotInArray', 'cipherstash/double@1'>>;
// @ts-expect-error cipherstashNotInArray must not surface on cipherstash/json@1.
type _nina_json_neg = Expect<M<'cipherstashNotInArray', 'cipherstash/json@1'>>;

// -- cipherstashGt (order-and-range trait — string/double/bigint/date) -------

type _gt_string_pos = Expect<M<'cipherstashGt', 'cipherstash/string@1'>>;
type _gt_double_pos = Expect<M<'cipherstashGt', 'cipherstash/double@1'>>;
type _gt_bigint_pos = Expect<M<'cipherstashGt', 'cipherstash/bigint@1'>>;
type _gt_date_pos = Expect<M<'cipherstashGt', 'cipherstash/date@1'>>;
// @ts-expect-error cipherstashGt must not surface on cipherstash/boolean@1 (no order-and-range trait).
type _gt_boolean_neg = Expect<M<'cipherstashGt', 'cipherstash/boolean@1'>>;
// @ts-expect-error cipherstashGt must not surface on cipherstash/json@1.
type _gt_json_neg = Expect<M<'cipherstashGt', 'cipherstash/json@1'>>;
// @ts-expect-error cipherstashGt must not surface on pg/text@1.
type _gt_text_neg = Expect<M<'cipherstashGt', 'pg/text@1'>>;

// -- cipherstashGte / cipherstashLt / cipherstashLte (same trait set) -------

type _gte_double_pos = Expect<M<'cipherstashGte', 'cipherstash/double@1'>>;
type _lt_bigint_pos = Expect<M<'cipherstashLt', 'cipherstash/bigint@1'>>;
type _lte_date_pos = Expect<M<'cipherstashLte', 'cipherstash/date@1'>>;
// @ts-expect-error cipherstashGte must not surface on cipherstash/boolean@1.
type _gte_boolean_neg = Expect<M<'cipherstashGte', 'cipherstash/boolean@1'>>;
// @ts-expect-error cipherstashLt must not surface on cipherstash/json@1.
type _lt_json_neg = Expect<M<'cipherstashLt', 'cipherstash/json@1'>>;

// -- cipherstashBetween / cipherstashNotBetween (order-and-range) -----------

type _between_string_pos = Expect<M<'cipherstashBetween', 'cipherstash/string@1'>>;
type _between_double_pos = Expect<M<'cipherstashBetween', 'cipherstash/double@1'>>;
type _notbetween_date_pos = Expect<M<'cipherstashNotBetween', 'cipherstash/date@1'>>;
// @ts-expect-error cipherstashBetween must not surface on cipherstash/boolean@1.
type _between_boolean_neg = Expect<M<'cipherstashBetween', 'cipherstash/boolean@1'>>;
// @ts-expect-error cipherstashNotBetween must not surface on pg/text@1.
type _notbetween_text_neg = Expect<M<'cipherstashNotBetween', 'pg/text@1'>>;

// -- cipherstashJsonbPathExists (json only — single-codec dispatch) ---------

type _jpe_json_pos = Expect<M<'cipherstashJsonbPathExists', 'cipherstash/json@1'>>;
// @ts-expect-error cipherstashJsonbPathExists must not surface on cipherstash/string@1.
type _jpe_string_neg = Expect<M<'cipherstashJsonbPathExists', 'cipherstash/string@1'>>;
// @ts-expect-error cipherstashJsonbPathExists must not surface on pg/text@1.
type _jpe_text_neg = Expect<M<'cipherstashJsonbPathExists', 'pg/text@1'>>;

// -- Anchor unused type aliases so noUnusedLocals stays happy ---------------

export type _Anchors = [
  _eq_string_pos,
  _eq_double_neg,
  _eq_text_neg,
  _ilike_string_pos,
  _ilike_double_neg,
  _notilike_string_pos,
  _notilike_double_neg,
  _notilike_text_neg,
  _ne_string_pos,
  _ne_double_pos,
  _ne_bigint_pos,
  _ne_date_pos,
  _ne_boolean_pos,
  _ne_json_neg,
  _ne_text_neg,
  _ina_string_pos,
  _ina_boolean_pos,
  _ina_json_neg,
  _ina_text_neg,
  _nina_double_pos,
  _nina_json_neg,
  _gt_string_pos,
  _gt_double_pos,
  _gt_bigint_pos,
  _gt_date_pos,
  _gt_boolean_neg,
  _gt_json_neg,
  _gt_text_neg,
  _gte_double_pos,
  _lt_bigint_pos,
  _lte_date_pos,
  _gte_boolean_neg,
  _lt_json_neg,
  _between_string_pos,
  _between_double_pos,
  _notbetween_date_pos,
  _between_boolean_neg,
  _notbetween_text_neg,
  _jpe_json_pos,
  _jpe_string_neg,
  _jpe_text_neg,
];
