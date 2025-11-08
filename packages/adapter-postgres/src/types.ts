import type {
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  Direction,
  InsertAst,
  JoinAst,
  LiteralExpr,
  OperationExpr,
  ParamRef,
  QueryAst,
  SelectAst,
  SqlContract,
  SqlStorage,
  StorageColumn,
  StorageTable,
  UpdateAst,
} from '@prisma-next/sql-target';

export interface PostgresAdapterOptions {
  readonly profileId?: string;
}

export type PostgresContract = SqlContract<SqlStorage> & { readonly target: 'postgres' };

export type Expr = ColumnRef | ParamRef;

export interface OrderClause {
  readonly expr: ColumnRef;
  readonly dir: Direction;
}

export type PostgresLoweredStatement = import('@prisma-next/sql-target').LoweredStatement;

export type {
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  Direction,
  InsertAst,
  JoinAst,
  LiteralExpr,
  OperationExpr,
  ParamRef,
  QueryAst,
  SelectAst,
  StorageColumn,
  StorageTable,
  UpdateAst,
};
