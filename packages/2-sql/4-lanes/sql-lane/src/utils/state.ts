import type { TableRef } from '@prisma-next/sql-relational-core/ast';
import type {
  AnyBinaryBuilder,
  AnyExpressionSource,
  AnyOrderBuilder,
  AnyUnaryBuilder,
  JoinOnPredicate,
} from '@prisma-next/sql-relational-core/types';

export interface ProjectionState {
  readonly aliases: string[];
  readonly columns: AnyExpressionSource[];
}

export interface JoinState {
  readonly joinType: 'inner' | 'left' | 'right' | 'full';
  readonly table: TableRef;
  readonly on: JoinOnPredicate;
}

export interface IncludeState {
  readonly alias: string;
  readonly table: TableRef;
  readonly on: JoinOnPredicate;
  readonly childProjection: ProjectionState;
  readonly childWhere?: AnyBinaryBuilder | AnyUnaryBuilder;
  readonly childOrderBy?: AnyOrderBuilder;
  readonly childLimit?: number;
}

export interface BuilderState {
  from?: TableRef;
  joins?: ReadonlyArray<JoinState>;
  includes?: ReadonlyArray<IncludeState>;
  projection?: ProjectionState;
  where?: AnyBinaryBuilder | AnyUnaryBuilder;
  orderBy?: AnyOrderBuilder;
  limit?: number;
}
