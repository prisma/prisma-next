import type { Contract, ContractModelDefinitions } from '@prisma-next/contract/types';
import type {
  UnboundTables as SqlBuilderUnboundTables,
  TableProxyContract,
} from '@prisma-next/sql-builder/types';
import type {
  ExtractCodecTypes,
  ExtractFieldOutputTypes,
  SqlStorage,
  StorageColumn,
} from '@prisma-next/sql-contract/types';
import type { DrainOuterGeneric } from './type-atoms';

type FindModelForTable<C, TableName extends string> = C extends Contract
  ? {
      [M in keyof ContractModelDefinitions<C> & string]: ContractModelDefinitions<C>[M] extends {
        readonly storage: { readonly table: TableName };
      }
        ? M
        : never;
    }[keyof ContractModelDefinitions<C> & string]
  : never;

type FindFieldForColumn<C, ModelName extends string, ColumnName extends string> = C extends Contract
  ? ModelName extends keyof ContractModelDefinitions<C>
    ? {
        [F in keyof ContractModelDefinitions<C>[ModelName]['storage']['fields'] &
          string]: ContractModelDefinitions<C>[ModelName]['storage']['fields'][F] extends {
          readonly column: ColumnName;
        }
          ? F
          : never;
      }[keyof ContractModelDefinitions<C>[ModelName]['storage']['fields'] & string]
    : never
  : never;

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
 * Consults `ExtractFieldOutputTypes` first so enum fields return their value
 * union instead of the raw codec output type. Falls back to the codec output
 * type when no field-level override exists.
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
      | FieldOutputTypeFor<TContract, TTableName, TColumnName, _TColumn>
  : never;

type EnumOutputOverride<TContract, TTableName extends string, TColumnName extends string> =
  FindModelForTable<TContract, TTableName> extends infer ModelName extends string
    ? ModelName extends keyof ExtractFieldOutputTypes<TContract>
      ? FindFieldForColumn<TContract, ModelName, TColumnName> extends infer FieldName extends string
        ? FieldName extends keyof ExtractFieldOutputTypes<TContract>[ModelName]
          ? ExtractFieldOutputTypes<TContract>[ModelName][FieldName]
          : never
        : never
      : never
    : never;

type FieldOutputTypeFor<
  TContract,
  TTableName extends string,
  TColumnName extends string,
  _TColumn,
> =
  EnumOutputOverride<TContract, TTableName, TColumnName> extends infer Override
    ? [Override] extends [never]
      ? CodecOutputType<TContract, _TColumn>
      : string extends NonNullable<Override>
        ? CodecOutputType<TContract, _TColumn>
        : NonNullable<Override>
    : never;

type CodecOutputType<TContract, _TColumn> = _TColumn extends StorageColumn
  ? ExtractCodecTypes<TContract>[_TColumn['codecId']]['output']
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
