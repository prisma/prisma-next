import type {
  Expression as AstExpression,
  ListLiteralExpr,
  LiteralExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import {
  DummyDriver,
  Kysely,
  type OperandExpression,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type SelectQueryBuilder,
  type SqlBool,
} from 'kysely';

export type AnyDB = Record<string, Record<string, unknown>>;
export type AnySelectQueryBuilder = SelectQueryBuilder<AnyDB, string, Record<string, unknown>>;
export type SqlComparable = AstExpression | ParamRef | LiteralExpr | ListLiteralExpr;
export type SqlPredicate = OperandExpression<SqlBool>;
export type SqlValueExpression = OperandExpression<unknown>;

export const queryCompiler = new Kysely<AnyDB>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});
