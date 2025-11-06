import type { SqlContract, SqlStorage, StorageColumn, StorageTable } from '@prisma-next/sql-target';
import type {
  BinaryExpr,
  ColumnRef,
  Direction,
  JoinAst,
  LoweredStatement,
  ParamRef,
  SelectAst,
} from '@prisma-next/sql-query/types';

export interface PostgresAdapterOptions {
  readonly profileId?: string;
}

export type PostgresContract = SqlContract<SqlStorage> & { readonly target: 'postgres' };

export type Expr = ColumnRef | ParamRef;

export interface OrderClause {
  readonly expr: ColumnRef;
  readonly dir: Direction;
}

export type PostgresLoweredStatement = LoweredStatement;

export type {
  BinaryExpr,
  ColumnRef,
  Direction,
  JoinAst,
  ParamRef,
  SelectAst,
  StorageColumn,
  StorageTable,
};
