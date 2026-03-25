import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';

export function createColumnParamDescriptor(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  columnName: string,
  index: number,
): ParamDescriptor {
  const columnMeta = contract.storage.tables[tableName]?.columns[columnName];

  return {
    index,
    name: columnName,
    source: 'dsl',
    ...(columnMeta
      ? {
          codecId: columnMeta.codecId,
          nativeType: columnMeta.nativeType,
          nullable: columnMeta.nullable,
          refs: { table: tableName, column: columnName },
        }
      : {}),
  };
}
