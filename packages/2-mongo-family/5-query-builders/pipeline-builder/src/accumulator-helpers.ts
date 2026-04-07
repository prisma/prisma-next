import { MongoAggAccumulator } from '@prisma-next/mongo-query-ast';
import type { DocField, TypedAccumulatorExpr, TypedAggExpr } from './types';

type NumericField = { readonly codecId: 'mongo/double@1'; readonly nullable: false };
type NullableNumericField = { readonly codecId: 'mongo/double@1'; readonly nullable: true };
type ArrayField = { readonly codecId: 'mongo/array@1'; readonly nullable: false };

export const acc = {
  sum(expr: TypedAggExpr<DocField>): TypedAccumulatorExpr<NumericField> {
    return {
      _field: { codecId: 'mongo/double@1', nullable: false } as NumericField,
      node: MongoAggAccumulator.sum(expr.node),
    };
  },

  avg(expr: TypedAggExpr<DocField>): TypedAccumulatorExpr<NullableNumericField> {
    return {
      _field: { codecId: 'mongo/double@1', nullable: true } as NullableNumericField,
      node: MongoAggAccumulator.avg(expr.node),
    };
  },

  min<F extends DocField>(
    expr: TypedAggExpr<F>,
  ): TypedAccumulatorExpr<{ readonly codecId: F['codecId']; readonly nullable: true }> {
    return {
      _field: { codecId: expr._field?.codecId, nullable: true } as {
        readonly codecId: F['codecId'];
        readonly nullable: true;
      },
      node: MongoAggAccumulator.min(expr.node),
    };
  },

  max<F extends DocField>(
    expr: TypedAggExpr<F>,
  ): TypedAccumulatorExpr<{ readonly codecId: F['codecId']; readonly nullable: true }> {
    return {
      _field: { codecId: expr._field?.codecId, nullable: true } as {
        readonly codecId: F['codecId'];
        readonly nullable: true;
      },
      node: MongoAggAccumulator.max(expr.node),
    };
  },

  first<F extends DocField>(
    expr: TypedAggExpr<F>,
  ): TypedAccumulatorExpr<{ readonly codecId: F['codecId']; readonly nullable: true }> {
    return {
      _field: { codecId: expr._field?.codecId, nullable: true } as {
        readonly codecId: F['codecId'];
        readonly nullable: true;
      },
      node: MongoAggAccumulator.first(expr.node),
    };
  },

  last<F extends DocField>(
    expr: TypedAggExpr<F>,
  ): TypedAccumulatorExpr<{ readonly codecId: F['codecId']; readonly nullable: true }> {
    return {
      _field: { codecId: expr._field?.codecId, nullable: true } as {
        readonly codecId: F['codecId'];
        readonly nullable: true;
      },
      node: MongoAggAccumulator.last(expr.node),
    };
  },

  push(expr: TypedAggExpr<DocField>): TypedAccumulatorExpr<ArrayField> {
    return {
      _field: { codecId: 'mongo/array@1', nullable: false } as ArrayField,
      node: MongoAggAccumulator.push(expr.node),
    };
  },

  addToSet(expr: TypedAggExpr<DocField>): TypedAccumulatorExpr<ArrayField> {
    return {
      _field: { codecId: 'mongo/array@1', nullable: false } as ArrayField,
      node: MongoAggAccumulator.addToSet(expr.node),
    };
  },

  count(): TypedAccumulatorExpr<NumericField> {
    return {
      _field: { codecId: 'mongo/double@1', nullable: false } as NumericField,
      node: MongoAggAccumulator.count(),
    };
  },
} as const;
