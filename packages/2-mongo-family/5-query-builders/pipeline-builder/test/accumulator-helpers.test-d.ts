import { expectTypeOf } from 'vitest';
import { acc } from '../src/accumulator-helpers';
import type {
  ArrayField,
  DocField,
  NullableNumericField,
  TypedAccumulatorExpr,
  TypedAggExpr,
} from '../src/types';

const d = {} as TypedAggExpr<DocField>;

describe('accumulator helper types', () => {
  it('stdDevPop returns NullableNumericField', () => {
    expectTypeOf(acc.stdDevPop(d)).toEqualTypeOf<TypedAccumulatorExpr<NullableNumericField>>();
  });

  it('stdDevSamp returns NullableNumericField', () => {
    expectTypeOf(acc.stdDevSamp(d)).toEqualTypeOf<TypedAccumulatorExpr<NullableNumericField>>();
  });

  it('firstN returns ArrayField', () => {
    expectTypeOf(acc.firstN({ input: d, n: d })).toEqualTypeOf<TypedAccumulatorExpr<ArrayField>>();
  });

  it('lastN returns ArrayField', () => {
    expectTypeOf(acc.lastN({ input: d, n: d })).toEqualTypeOf<TypedAccumulatorExpr<ArrayField>>();
  });

  it('maxN returns ArrayField', () => {
    expectTypeOf(acc.maxN({ input: d, n: d })).toEqualTypeOf<TypedAccumulatorExpr<ArrayField>>();
  });

  it('minN returns ArrayField', () => {
    expectTypeOf(acc.minN({ input: d, n: d })).toEqualTypeOf<TypedAccumulatorExpr<ArrayField>>();
  });

  it('top returns DocField', () => {
    expectTypeOf(acc.top({ output: d, sortBy: d })).toEqualTypeOf<TypedAccumulatorExpr<DocField>>();
  });

  it('bottom returns DocField', () => {
    expectTypeOf(acc.bottom({ output: d, sortBy: d })).toEqualTypeOf<
      TypedAccumulatorExpr<DocField>
    >();
  });

  it('topN returns ArrayField', () => {
    expectTypeOf(acc.topN({ output: d, sortBy: d, n: d })).toEqualTypeOf<
      TypedAccumulatorExpr<ArrayField>
    >();
  });

  it('bottomN returns ArrayField', () => {
    expectTypeOf(acc.bottomN({ output: d, sortBy: d, n: d })).toEqualTypeOf<
      TypedAccumulatorExpr<ArrayField>
    >();
  });
});
