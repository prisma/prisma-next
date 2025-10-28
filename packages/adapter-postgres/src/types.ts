import type {
  BinaryExpr,
  ColumnRef,
  ContractStorage,
  DataContract,
  Direction,
  LoweredStatement,
  ParamRef,
  SelectAst,
  StorageColumn,
  StorageTable,
} from '@prisma-next/sql/types';

export interface PostgresAdapterOptions {
  readonly profileId?: string;
}

export type PostgresContract = DataContract & { readonly target: 'postgres' };

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
