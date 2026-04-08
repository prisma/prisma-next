import { MongoAggAccumulator } from '@prisma-next/mongo-query-ast';
import type {
  ArrayField,
  DocField,
  NullableNumericField,
  NumericField,
  TypedAccumulatorExpr,
  TypedAggExpr,
} from './types';

export const acc = {
  sum(expr: TypedAggExpr<DocField>): TypedAccumulatorExpr<NumericField> {
    return {
      _field: undefined as never,
      node: MongoAggAccumulator.sum(expr.node),
    };
  },

  avg(expr: TypedAggExpr<DocField>): TypedAccumulatorExpr<NullableNumericField> {
    return {
      _field: undefined as never,
      node: MongoAggAccumulator.avg(expr.node),
    };
  },

  min<F extends DocField>(
    expr: TypedAggExpr<F>,
  ): TypedAccumulatorExpr<{ readonly codecId: F['codecId']; readonly nullable: true }> {
    return {
      _field: undefined as never,
      node: MongoAggAccumulator.min(expr.node),
    };
  },

  max<F extends DocField>(
    expr: TypedAggExpr<F>,
  ): TypedAccumulatorExpr<{ readonly codecId: F['codecId']; readonly nullable: true }> {
    return {
      _field: undefined as never,
      node: MongoAggAccumulator.max(expr.node),
    };
  },

  first<F extends DocField>(
    expr: TypedAggExpr<F>,
  ): TypedAccumulatorExpr<{ readonly codecId: F['codecId']; readonly nullable: true }> {
    return {
      _field: undefined as never,
      node: MongoAggAccumulator.first(expr.node),
    };
  },

  last<F extends DocField>(
    expr: TypedAggExpr<F>,
  ): TypedAccumulatorExpr<{ readonly codecId: F['codecId']; readonly nullable: true }> {
    return {
      _field: undefined as never,
      node: MongoAggAccumulator.last(expr.node),
    };
  },

  push(expr: TypedAggExpr<DocField>): TypedAccumulatorExpr<ArrayField> {
    return {
      _field: undefined as never,
      node: MongoAggAccumulator.push(expr.node),
    };
  },

  addToSet(expr: TypedAggExpr<DocField>): TypedAccumulatorExpr<ArrayField> {
    return {
      _field: undefined as never,
      node: MongoAggAccumulator.addToSet(expr.node),
    };
  },

  count(): TypedAccumulatorExpr<NumericField> {
    return {
      _field: undefined as never,
      node: MongoAggAccumulator.count(),
    };
  },
};
