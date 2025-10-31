import type {
  ContractStorage,
  SqlContract,
  StorageColumn,
  StorageTable,
} from '@prisma-next/contract/types';
import type {
  BinaryExpr,
  ColumnRef,
  Direction,
  LoweredStatement,
  ParamRef,
  SelectAst,
} from '@prisma-next/sql/types';

export interface PostgresAdapterOptions {
  readonly profileId?: string;
}

export type PostgresContract = SqlContract & { readonly target: 'postgres' };

export type Expr = ColumnRef | ParamRef;

export interface OrderClause {
  readonly expr: ColumnRef;
  readonly dir: Direction;
}

export type PostgresLoweredStatement = LoweredStatement;

export type {
  BinaryExpr,
  ColumnRef,
  ContractStorage,
  Direction,
  ParamRef,
  SelectAst,
  StorageColumn,
  StorageTable,
};
