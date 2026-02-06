import type {
  SqlContract,
  SqlStorage,
  StorageColumn,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import type {
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  Direction,
  InsertAst,
  JoinAst,
  LiteralExpr,
  LoweredStatement,
  OperationExpr,
  ParamRef,
  QueryAst,
  SelectAst,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';

export interface SqliteAdapterOptions {
  readonly profileId?: string;
}

export type SqliteContract = SqlContract<SqlStorage> & { readonly target: 'sqlite' };

export type Expr = ColumnRef | ParamRef;

export interface OrderClause {
  readonly expr: ColumnRef;
  readonly dir: Direction;
}

export type SqliteLoweredStatement = LoweredStatement;

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
