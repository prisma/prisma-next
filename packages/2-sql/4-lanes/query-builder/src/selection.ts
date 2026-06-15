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

/**
 * Flat table map for the query-builder surface: every table name declared in
 * any storage namespace, with colliding names unioned (parity with
 * `@prisma-next/sql-builder`).
 */
export type UnboundTables<TContract extends Contract<SqlStorage>> = SqlBuilderUnboundTables<
  TContract & TableProxyContract
>;

/**
 * The field-output override (the enum value union) for a `table.column`, or
 * `never` when no model field maps to it. The emitted `FieldOutputTypes`
 * TypeMap is keyed by model/field, so one pass over the models matches both the
 * `storage.table` and the field's `storage.fields[*].column` to read the
 * already-narrowed type back out.
 */
type FieldOutputOverride<
  TContract extends Contract,
  TTableName extends string,
  TColumnName extends string,
  Models = ContractModelDefinitions<TContract>,
  FOT = ExtractFieldOutputTypes<TContract>,
> = {
  [M in keyof Models & keyof FOT & string]: Models[M] extends {
    readonly storage: { readonly table: TTableName; readonly fields: infer Fields };
  }
    ? {
        [F in keyof Fields & keyof FOT[M] & string]: Fields[F] extends {
          readonly column: TColumnName;
        }
          ? FOT[M][F]
          : never;
      }[keyof Fields & keyof FOT[M] & string]
    : never;
}[keyof Models & keyof FOT & string];

/**
 * The output type of a referenced column. Returns the enum value union from the
 * `FieldOutputTypes` TypeMap when the column is enum-typed (the override already
 * carries the correct nullability), otherwise the codec output type with column
 * nullability applied.
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
> = [FieldOutputOverride<TContract, TTableName, TColumnName>] extends [never]
  ? _TColumn extends StorageColumn
    ?
        | (_TColumn['nullable'] extends true ? null : never)
        | ExtractCodecTypes<TContract>[_TColumn['codecId']]['output']
    : never
  : FieldOutputOverride<TContract, TTableName, TColumnName>;

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
