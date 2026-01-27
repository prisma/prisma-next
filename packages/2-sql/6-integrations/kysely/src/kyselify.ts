import type { SqlContract, StorageColumn } from '@prisma-next/sql-contract/types';

export type KyselifyContract<TContract extends SqlContract> = {
  -readonly [TableName in keyof TablesOf<TContract>]-?: {
    -readonly [ColumnName in keyof ColumnsOf<TContract, TableName>]-?: KyselifyStorageColumn<
      GimmeStorageColumn<TContract, TableName, ColumnName>,
      TContract['mappings']['codecTypes'][GimmeStorageColumn<
        TContract,
        TableName,
        ColumnName
      >['codecId']]
    >;
  };
};

export type TablesOf<TContract extends SqlContract> = TContract['storage']['tables'];

export type ColumnsOf<
  TContract extends SqlContract,
  TTableName extends keyof TablesOf<TContract>,
> = TablesOf<TContract>[TTableName]['columns'];

export type GimmeStorageColumn<
  TContract extends SqlContract,
  TTableName extends keyof TablesOf<TContract>,
  TColumnName extends keyof ColumnsOf<TContract, TTableName>,
> = ColumnsOf<TContract, TTableName>[TColumnName];

export type KyselifyStorageColumn<
  TColumn,
  TCodec extends SqlContract['mappings']['codecTypes'][string],
> = TColumn extends StorageColumn
  ? (TColumn['nullable'] extends true ? null : never) | TCodec['output']
  : never;
