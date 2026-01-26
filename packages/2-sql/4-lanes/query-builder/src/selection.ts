import type { SqlContract, StorageColumn } from '@prisma-next/sql-contract/types';
import type { DrainOuterGeneric } from './type-atoms';

/**
 * A utility type to extract the output type of a referenced column from a contract.
 *
 * @template TContract The contract that describes the database.
 * @template TTableName The name of the table containing the column.
 * @template TColumnName The name of the column whose output type is to be extracted.
 */
export type ExtractOutputType<
  TContract extends SqlContract,
  TTableName extends keyof TContract['storage']['tables'] & string,
  TColumnName extends keyof TContract['storage']['tables'][TTableName]['columns'] & string,
  _TColumn = TContract['storage']['tables'][TTableName]['columns'][TColumnName],
> = _TColumn extends StorageColumn
  ?
      | (_TColumn['nullable'] extends true ? null : never)
      | TContract['mappings']['codecTypes'][_TColumn['codecId']]['output']
  : never;

/**
 * A type representing a selection of columns in a SQL `select` query in the
 * most generic form.
 */
export type Selection = Record<string, SelectionValue<any, any>>;

/**
 * A type representing the value of a selected column in a SQL `select` query.
 *
 * @template TOutput The output type of the selected column.
 * @template TDatatype The database-side datatype of the selected column.
 */
export interface SelectionValue<TOutput, TDatatype extends string | unknown = unknown> {
  readonly '~datatype': TDatatype;
  readonly '~output': TOutput;
}

/**
 * A utility type to convert a table's columns into a {@link Selection}.
 *
 * @template TContract The contract that describes the database.
 * @template TTableName The name of the table whose columns will be included in the selection.
 */
export type TableToSelection<
  TContract extends SqlContract,
  TTableName extends keyof TContract['storage']['tables'] & string,
> = DrainOuterGeneric<{
  readonly [ColumnName in keyof TContract['storage']['tables'][TTableName]['columns'] &
    string]: SelectionValue<
    ExtractOutputType<TContract, TTableName, ColumnName>,
    TContract['storage']['tables'][TTableName]['columns'][ColumnName]['nativeType']
  >;
}>;
