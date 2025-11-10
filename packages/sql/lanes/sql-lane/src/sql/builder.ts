import type { ParamPlaceholder, SqlBuilderOptions } from '@prisma-next/sql-relational-core/types';
import type {
  ExtractCodecTypes,
  ExtractOperationTypes,
  SqlContract,
  SqlStorage,
  TableRef,
} from '@prisma-next/sql-target';
import { createRawFactory } from '../raw';
import type { SelectBuilder } from '../types/public';
import { DeleteBuilderImpl, InsertBuilderImpl, UpdateBuilderImpl } from './mutation-builder';
import { SelectBuilderImpl } from './select-builder';

export { createJoinOnBuilder } from '@prisma-next/sql-relational-core/ast';
export type { DeleteBuilder, InsertBuilder, SelectBuilder, UpdateBuilder } from '../types/public';
export type { IncludeChildBuilder } from './include-builder';

export function sql<
  TContract extends SqlContract<SqlStorage>,
  CodecTypesOverride extends Record<
    string,
    { readonly output: unknown }
  > = ExtractCodecTypes<TContract>,
>(
  options: SqlBuilderOptions<TContract>,
): SelectBuilder<TContract, unknown, CodecTypesOverride, ExtractOperationTypes<TContract>> {
  type CodecTypes = CodecTypesOverride;
  type Operations = ExtractOperationTypes<TContract>;
  const builder = new SelectBuilderImpl<TContract, unknown, CodecTypes, Record<string, never>>(
    options,
  ) as SelectBuilder<TContract, unknown, CodecTypes, Operations>;
  const rawFactory = createRawFactory(options.context.contract);

  Object.defineProperty(builder, 'raw', {
    value: rawFactory,
    enumerable: true,
    configurable: false,
  });

  Object.defineProperty(builder, 'insert', {
    value: (table: TableRef, values: Record<string, ParamPlaceholder>) => {
      return new InsertBuilderImpl<TContract, CodecTypes>(options, table, values);
    },
    enumerable: true,
    configurable: false,
  });

  Object.defineProperty(builder, 'update', {
    value: (table: TableRef, set: Record<string, ParamPlaceholder>) => {
      return new UpdateBuilderImpl<TContract, CodecTypes>(options, table, set);
    },
    enumerable: true,
    configurable: false,
  });

  Object.defineProperty(builder, 'delete', {
    value: (table: TableRef) => {
      return new DeleteBuilderImpl<TContract, CodecTypes>(options, table);
    },
    enumerable: true,
    configurable: false,
  });

  return builder;
}
