/**
 * Type-level regression test for the family-SQL `CodecIdsWithTrait`
 * filter at `src/types/operation-types.ts`.
 *
 * The bug being pinned: the previous gate body
 * (`[Trait] extends [T extends readonly string[] ? T[number] : never]`)
 * required `T` (the codec's `traits` slot) to be a tuple. But
 * `ExtractCodecTypes<TContract>` in `relational-core/src/expression.ts`
 * flattens descriptor `traits` tuples to string unions via
 * `DescriptorCodecTraits<D> = TTraits[number] & CodecTrait`. Every
 * real-contract instantiation therefore presented `T` as a union, the
 * tuple gate fell through to `never`, and `EqualityCodecId<CT>` /
 * `OrderCodecId<CT>` / `TextualCodecId<CT>` cascaded to `never` for
 * every real consumer. The downstream symptoms were the impl signature
 * `<CodecId extends EqualityCodecId<CT>>(...) => PgBoolReturn`
 * resolving to `<CodecId extends never>(...) => ...`, which made
 * `fns.eq(intCol, 1)` and `column.eq(value)` reject every concrete arg
 * with `Argument of type '1' is not assignable to parameter of type
 * 'CodecExpression<never, boolean, CodecTypes>'`.
 *
 * The fixed gate body (`[RequiredTraits[number]] extends [T]`) handles
 * both tuple and union `T`. This test pins the union-shaped input the
 * real-contract case always presents, plus a couple of negative-case
 * probes so a future "optimisation" that re-introduces the tuple-gate
 * regression trips loudly.
 */

import { describe, expectTypeOf, test } from 'vitest';
import type {
  EqualityCodecId,
  OrderCodecId,
  TextualCodecId,
} from '../src/exports/operation-types';

/**
 * Codec-types fixture in the shape `ExtractCodecTypes<TContract>`
 * actually produces: each codec's `traits` slot is a string union
 * (not a tuple). Covers a representative mix:
 *
 *   - `pg/int4@1` declares `equality + order + numeric` (textual absent).
 *   - `pg/text@1` declares `equality + order + textual` (numeric absent).
 *   - `pg/bool@1` declares `equality + boolean` only (no order, no textual).
 *   - `cipherstash/string@1` declares only namespaced traits
 *     (`cipherstash:*`) -- no framework-canonical trait.
 *
 * Keeping the shape inline (rather than importing a generated contract)
 * keeps this test fast to typecheck and independent of fixture drift.
 */
type TestCT = {
  readonly 'pg/int4@1': {
    readonly input: number;
    readonly output: number;
    readonly traits: 'equality' | 'order' | 'numeric';
  };
  readonly 'pg/text@1': {
    readonly input: string;
    readonly output: string;
    readonly traits: 'equality' | 'order' | 'textual';
  };
  readonly 'pg/bool@1': {
    readonly input: boolean;
    readonly output: boolean;
    readonly traits: 'equality' | 'boolean';
  };
  readonly 'cipherstash/string@1': {
    readonly input: string;
    readonly output: string;
    readonly traits: 'cipherstash:equality' | 'cipherstash:textual';
  };
};

describe('CodecIdsWithTrait filter resolves union-shaped traits (regression for the family-SQL tuple-gate bug)', () => {
  test('EqualityCodecId<CT> includes every codec id declaring equality', () => {
    expectTypeOf<EqualityCodecId<TestCT>>().toEqualTypeOf<
      'pg/int4@1' | 'pg/text@1' | 'pg/bool@1'
    >();
  });

  test('OrderCodecId<CT> includes every codec id declaring order', () => {
    expectTypeOf<OrderCodecId<TestCT>>().toEqualTypeOf<'pg/int4@1' | 'pg/text@1'>();
  });

  test('TextualCodecId<CT> includes only codec ids declaring textual', () => {
    expectTypeOf<TextualCodecId<TestCT>>().toEqualTypeOf<'pg/text@1'>();
  });

  test('cipherstash-style codecs (only namespaced traits) are excluded from EqualityCodecId', () => {
    type Eq = EqualityCodecId<TestCT>;
    expectTypeOf<'cipherstash/string@1' extends Eq ? true : false>().toEqualTypeOf<false>();
  });

  test('cipherstash-style codecs are excluded from OrderCodecId', () => {
    type Ord = OrderCodecId<TestCT>;
    expectTypeOf<'cipherstash/string@1' extends Ord ? true : false>().toEqualTypeOf<false>();
  });

  test('cipherstash-style codecs are excluded from TextualCodecId', () => {
    type Txt = TextualCodecId<TestCT>;
    expectTypeOf<'cipherstash/string@1' extends Txt ? true : false>().toEqualTypeOf<false>();
  });

  test('no real-contract codec id cascades to never (the load-bearing symptom of the original bug)', () => {
    // The original bug surfaced as `EqualityCodecId<CT> = never` for every
    // real contract -- which then forced `<CodecId extends never>` on the
    // family impls and broke every consumer call site. Pin the negative.
    expectTypeOf<[EqualityCodecId<TestCT>] extends [never] ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<[OrderCodecId<TestCT>] extends [never] ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<[TextualCodecId<TestCT>] extends [never] ? true : false>().toEqualTypeOf<false>();
  });
});
