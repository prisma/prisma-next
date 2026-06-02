import type { Contract } from '@prisma-next/contract/types';
import type {
  UnboundTables as SqlBuilderUnboundTables,
  TableProxyContract,
} from '@prisma-next/sql-builder/types';
import type { ExtractCodecTypes, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type { DrainOuterGeneric } from './type-atoms';

/**
 * Flat table map for the query-builder surface: every table name declared in
 * any storage namespace, with colliding names unioned (parity with
 * `@prisma-next/sql-builder`).
 */
export type UnboundTables<TContract extends Contract<SqlStorage>> = SqlBuilderUnboundTables<
  TContract & TableProxyContract
>;

/**
 * A utility type to extract the output type of a referenced column from a contract.
 * Uses the type-only codec channel (ExtractCodecTypes), not runtime mappings.
 *
 * @template TContract The contract that describes the database.
 * @template TTableName The name of the table containing the column.
 * @template TColumnName The name of the column whose output type is to be extracted.
 */
export type ExtractOutputType<
  TContract extends Contract<SqlStorage>,
  TTableName extends keyof UnboundTables<TContract> & string,
  TColumnName extends keyof UnboundTables<TContract>[TTableName]['columns'] & string,
  _TColumn = UnboundTables<TContract>[TTableName]['columns'][TColumnName],
> = _TColumn extends StorageColumn
  ?
      | (_TColumn['nullable'] extends true ? null : never)
      | ExtractCodecTypes<TContract>[_TColumn['codecId']]['output']
  : never;

/**
 * A type representing a selection of columns in a SQL `select` query in the
 * most generic form.
 */
export type Selection = Record<string, SelectionValue<unknown, unknown>>;

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
  TContract extends Contract<SqlStorage>,
  TTableName extends keyof UnboundTables<TContract> & string,
> = DrainOuterGeneric<{
  readonly [ColumnName in keyof UnboundTables<TContract>[TTableName]['columns'] &
    string]: SelectionValue<
    ExtractOutputType<TContract, TTableName, ColumnName>,
    UnboundTables<TContract>[TTableName]['columns'][ColumnName]['nativeType']
  >;
}>;
