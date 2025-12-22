import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { TableRef } from '@prisma-next/sql-relational-core/ast';
import type { ParamPlaceholder, RawFactory } from '@prisma-next/sql-relational-core/types';
import type { DeleteBuilder, InsertBuilder, UpdateBuilder } from '../sql/mutation-builder';
import type { SelectBuilderImpl } from '../sql/select-builder';

export type { TableRef } from '@prisma-next/sql-relational-core/ast';
export type {
  AnyColumnBuilder,
  BuildOptions,
  InferReturningRow,
  ParamPlaceholder,
  RawFactory,
  SqlBuilderOptions,
} from '@prisma-next/sql-relational-core/types';

export type SelectBuilder<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  Row = unknown,
  CodecTypes extends Record<string, { readonly output: unknown }> = Record<string, never>,
  Includes extends Record<string, unknown> = Record<string, never>,
> = SelectBuilderImpl<TContract, Row, CodecTypes, Includes> & {
  readonly raw: RawFactory;
  insert(
    table: TableRef,
    values: Record<string, ParamPlaceholder>,
  ): InsertBuilder<TContract, CodecTypes>;
  update(
    table: TableRef,
    set: Record<string, ParamPlaceholder>,
  ): UpdateBuilder<TContract, CodecTypes>;
  delete(table: TableRef): DeleteBuilder<TContract, CodecTypes>;
};

export type { IncludeChildBuilder } from '../sql/include-builder';
export type { DeleteBuilder, InsertBuilder, UpdateBuilder } from '../sql/mutation-builder';
