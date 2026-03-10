import type {
  ExtractTypeMapsFromContract,
  ResolveCodecTypes,
  ResolveOperationTypes,
  SqlContract,
  SqlStorage,
} from '@prisma-next/sql-contract/types';
import type { TableRef } from '@prisma-next/sql-relational-core/ast';
import { createJoinOnBuilder } from '@prisma-next/sql-relational-core/ast';
import type { ParamPlaceholder, SqlBuilderOptions } from '@prisma-next/sql-relational-core/types';
import { createRawFactory } from '../raw';
import type { SelectBuilder } from '../types/public';
import { DeleteBuilderImpl, InsertBuilderImpl, UpdateBuilderImpl } from './mutation-builder';
import { SelectBuilderImpl } from './select-builder';

export { createJoinOnBuilder };
export type { DeleteBuilder, InsertBuilder, SelectBuilder, UpdateBuilder } from '../types/public';
export type { IncludeChildBuilder } from './include-builder';

export function sql<
  TContract extends SqlContract<SqlStorage>,
  TTypeMaps = ExtractTypeMapsFromContract<TContract>,
>(
  options: SqlBuilderOptions<TContract>,
): SelectBuilder<
  TContract,
  unknown,
  ResolveCodecTypes<TContract, TTypeMaps>,
  ResolveOperationTypes<TContract, TTypeMaps>
> {
  type CodecTypes = ResolveCodecTypes<TContract, TTypeMaps>;
  type Operations = ResolveOperationTypes<TContract, TTypeMaps>;
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
