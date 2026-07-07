import type { CodecRegistry } from '@prisma-next/framework-components/codec';
import type { StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
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
  /**
   * Codec lookup used by the SQL renderer to resolve per-codec metadata at
   * lower-time. Defaults to a Postgres-builtins-only lookup when omitted —
   * see {@link createPostgresBuiltinCodecLookup} in `./codec-lookup`.
   *
   * Stack-aware callers (`SqlRuntimeAdapterDescriptor.create(stack)` /
   * `SqlControlAdapterDescriptor.create(stack)`) supply the assembled stack
   * lookup so extension codecs are visible to the renderer.
   */
  readonly codecLookup?: CodecRegistry;
}

export type { PostgresContract } from '@prisma-next/target-postgres/types';

export type Expr = ColumnRef | ParamRef | DefaultValueExpr;

export interface OrderClause {
  readonly expr: ColumnRef;
  readonly dir: Direction;
}

export type PostgresLoweredStatement = LoweredStatement;

export type {
  AnyQueryAst,
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
  SelectAst,
  StorageColumn,
  StorageTable,
  UpdateAst,
};
