import type { MongoAggExpr } from '@prisma-next/mongo-query-ast';
import { MongoAggCond, MongoAggLiteral, MongoAggOperator } from '@prisma-next/mongo-query-ast';
import type { DocField, TypedAggExpr } from './types';

type NumericField = { readonly codecId: 'mongo/double@1'; readonly nullable: false };
type StringField = { readonly codecId: 'mongo/string@1'; readonly nullable: false };

function numericExpr(op: string, args: TypedAggExpr<DocField>[]): TypedAggExpr<NumericField> {
  return {
    _field: { codecId: 'mongo/double@1', nullable: false } as NumericField,
    node: MongoAggOperator.of(
      op,
      args.map((a) => a.node),
    ),
  };
}

function stringExpr(op: string, args: TypedAggExpr<DocField>[]): TypedAggExpr<StringField> {
  return {
    _field: { codecId: 'mongo/string@1', nullable: false } as StringField,
    node: MongoAggOperator.of(
      op,
      args.map((a) => a.node),
    ),
  };
}

function stringUnaryExpr(op: string, arg: TypedAggExpr<DocField>): TypedAggExpr<StringField> {
  return {
    _field: { codecId: 'mongo/string@1', nullable: false } as StringField,
    node: MongoAggOperator.of(op, arg.node),
  };
}

export const fn = {
  add(...args: TypedAggExpr<DocField>[]): TypedAggExpr<NumericField> {
    return numericExpr('$add', args);
  },

  subtract(a: TypedAggExpr<DocField>, b: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericExpr('$subtract', [a, b]);
  },

  multiply(...args: TypedAggExpr<DocField>[]): TypedAggExpr<NumericField> {
    return numericExpr('$multiply', args);
  },

  divide(a: TypedAggExpr<DocField>, b: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericExpr('$divide', [a, b]);
  },

  concat(...args: TypedAggExpr<DocField>[]): TypedAggExpr<StringField> {
    return stringExpr('$concat', args);
  },

  toLower(a: TypedAggExpr<DocField>): TypedAggExpr<StringField> {
    return stringUnaryExpr('$toLower', a);
  },

  toUpper(a: TypedAggExpr<DocField>): TypedAggExpr<StringField> {
    return stringUnaryExpr('$toUpper', a);
  },

  size(a: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return {
      _field: { codecId: 'mongo/double@1', nullable: false } as NumericField,
      node: MongoAggOperator.of('$size', a.node),
    };
  },

  cond<F extends DocField>(
    condition: MongoAggExpr,
    thenExpr: TypedAggExpr<F>,
    elseExpr: TypedAggExpr<DocField>,
  ): TypedAggExpr<F> {
    return {
      _field: thenExpr._field,
      node: new MongoAggCond(condition, thenExpr.node, elseExpr.node),
    };
  },

  literal<F extends DocField>(value: unknown): TypedAggExpr<F> {
    return {
      _field: undefined as never,
      node: MongoAggLiteral.of(value),
    };
  },
} as const;
