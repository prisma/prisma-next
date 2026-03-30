import type {
  SqlContract,
  SqlStorage,
  StorageColumn,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import type {
  AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  Direction,
  InsertAst,
  JoinAst,
  LiteralExpr,
  LoweredStatement,
  OperationExpr,
  ParamRef,
  SelectAst,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';

export interface PostgresAdapterOptions {
  readonly profileId?: string;
}

export type PostgresContract = SqlContract<SqlStorage> & { readonly target: 'postgres' };

export type Expr = ColumnRef | ParamRef | DefaultValueExpr;

export interface OrderClause {
  readonly expr: ColumnRef;
  readonly dir: Direction;
}

export type PostgresLoweredStatement = LoweredStatement;

export type {
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  Direction,
  InsertAst,
  JoinAst,
  LiteralExpr,
  OperationExpr,
  ParamRef,
  AnyQueryAst,
  SelectAst,
  StorageColumn,
  StorageTable,
  UpdateAst,
};
