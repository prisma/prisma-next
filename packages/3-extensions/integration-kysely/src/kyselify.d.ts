import type { CodecTypes, ColumnsOf, TablesOf } from '@prisma-next/sql-relational-core/types';
import type { SqlContract, StorageColumn } from '@prisma-next/sql-contract/types';

export type KyselifyContract<TContract extends SqlContract> = {
  -readonly [TableName in keyof TablesOf<TContract>]-?: {
    -readonly [ColumnName in keyof ColumnsOf<TContract, TableName & string>]-?: KyselifyStorageColumn<
      ColumnsOf<TContract, TableName & string>[ColumnName],
      TContract['mappings']['codecTypes'][ColumnsOf<
        TContract,
        TableName & string
      >[ColumnName]['codecId']]
    >;
  };
};

type KyselifyStorageColumn<
  TColumn,
  TCodec extends CodecTypes[string],
> = TColumn extends StorageColumn
  ? (TColumn['nullable'] extends true ? null : never) | TCodec['output']
  : never;
