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
 * The literal storage-column shape for `table.column`, read straight off
 * `storage.namespaces[ns].entries.table[table].columns[column]`. Going through
 * `UnboundTables` widens columns to the `StorageColumn` class shape and erases
 * the literal `valueSet` ref, so the ref-following path reads the column here
 * instead. Unions the matching column across every namespace that declares the
 * table (parity with `UnboundTables`' name flattening).
 */
type LiteralColumnsOf<TContract extends Contract<SqlStorage>, TTableName extends string> = {
  [NsId in keyof TContract['storage']['namespaces']]: TContract['storage']['namespaces'][NsId] extends {
    readonly entries: { readonly table: infer Tables };
  }
    ? TTableName extends keyof Tables
      ? Tables[TTableName] extends { readonly columns: infer Columns }
        ? Columns
        : never
      : never
    : never;
}[keyof TContract['storage']['namespaces']];

type LiteralColumnOf<
  TContract extends Contract<SqlStorage>,
  TTableName extends string,
  TColumnName extends string,
> =
  LiteralColumnsOf<TContract, TTableName> extends infer Columns
    ? TColumnName extends keyof Columns
      ? Columns[TColumnName]
      : never
    : never;

/**
 * Resolves a storage column's own `valueSet` ref to the value union of the
 * referenced storage value-set, or `never` when the column carries no ref or
 * the ref does not resolve. Intra-plane: a storage column references a storage
 * value-set, indexed directly off `storage.namespaces[ns].entries.valueSet`. No
 * model field, no cross-plane reach.
 */
type ColumnValueSetUnion<TContract extends Contract<SqlStorage>, TColumn> = TColumn extends {
  readonly valueSet: {
    readonly namespaceId: infer NsId extends string;
    readonly entityName: infer Name extends string;
  };
}
  ? NsId extends keyof TContract['storage']['namespaces']
    ? TContract['storage']['namespaces'][NsId] extends {
        readonly entries: { readonly valueSet: infer ValueSets };
      }
      ? Name extends keyof ValueSets
        ? ValueSets[Name] extends { readonly values: infer Values extends readonly unknown[] }
          ? Values[number]
          : never
        : never
      : never
    : never
  : never;

type FindModelForTable<TContract, TableName extends string> = TContract extends Contract
  ? {
      [M in keyof ContractModelDefinitions<TContract> &
        string]: ContractModelDefinitions<TContract>[M] extends {
        readonly storage: { readonly table: TableName };
      }
        ? M
        : never;
    }[keyof ContractModelDefinitions<TContract> & string]
  : never;

type FindFieldForColumn<
  TContract,
  ModelName extends string,
  ColumnName extends string,
> = TContract extends Contract
  ? ModelName extends keyof ContractModelDefinitions<TContract>
    ? {
        [F in keyof ContractModelDefinitions<TContract>[ModelName]['storage']['fields'] &
          string]: ContractModelDefinitions<TContract>[ModelName]['storage']['fields'][F] extends {
          readonly column: ColumnName;
        }
          ? F
          : never;
      }[keyof ContractModelDefinitions<TContract>[ModelName]['storage']['fields'] & string]
    : never
  : never;

/**
 * The non-enum field output for a column, read from the still-baked
 * `FieldOutputTypes` map. Carries the enum union in the no-emit (`typeof
 * contract`) flow — where the authored object's storage column has no literal
 * `valueSet` ref — plus value-objects, parameterized codecs, and unions.
 * `never` when no model field maps to the column or the entry is absent.
 */
type BakedColumnOutput<
  TContract extends Contract<SqlStorage>,
  TableName extends string,
  ColumnName extends string,
  FOT = ExtractFieldOutputTypes<TContract>,
> = string extends keyof FOT
  ? never
  : FindModelForTable<TContract, TableName> extends infer ModelName extends string
    ? ModelName extends keyof FOT
      ? FindFieldForColumn<TContract, ModelName, ColumnName> extends infer FieldName extends string
        ? FieldName extends keyof FOT[ModelName & keyof FOT]
          ? FOT[ModelName & keyof FOT][FieldName & keyof FOT[ModelName & keyof FOT]]
          : never
        : never
      : never
    : never;

/**
 * The output type of a referenced column. Follows the column's own storage
 * `valueSet` ref to the value-set union when present (emitted flow); otherwise
 * falls back to the baked `FieldOutputTypes` entry (carries the enum union in
 * the no-emit flow plus value-objects/parameterized codecs/unions); otherwise
 * the codec output. Column nullability applied in every branch. The ref path
 * never depends on a model field existing — a raw value-set column (storage
 * ref, no domain enum) still types from the value-set.
 *
 * @template TContract The contract that describes the database.
 * @template TTableName The name of the table containing the column.
 * @template TColumnName The name of the column whose output type is to be extracted.
 */
export type ExtractOutputType<
  TContract extends Contract<SqlStorage>,
  TTableName extends keyof UnboundTables<TContract> & string,
  TColumnName extends keyof UnboundTables<TContract>[TTableName]['columns'] & string,
  _TColumn = LiteralColumnOf<TContract, TTableName, TColumnName>,
> = _TColumn extends StorageColumn
  ? [ColumnValueSetUnion<TContract, _TColumn>] extends [never]
    ? [BakedColumnOutput<TContract, TTableName, TColumnName>] extends [never]
      ?
          | (_TColumn['nullable'] extends true ? null : never)
          | ExtractCodecTypes<TContract>[_TColumn['codecId'] & string]['output']
      :
          | (_TColumn['nullable'] extends true ? null : never)
          | NonNullable<BakedColumnOutput<TContract, TTableName, TColumnName>>
    : (_TColumn['nullable'] extends true ? null : never) | ColumnValueSetUnion<TContract, _TColumn>
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
  _Columns = LiteralColumnsOf<TContract, TTableName>,
> = DrainOuterGeneric<{
  readonly [ColumnName in keyof _Columns & string]: SelectionValue<
    ExtractOutputType<TContract, TTableName, ColumnName>,
    _Columns[ColumnName] extends { readonly nativeType: infer N } ? N : unknown
  >;
}>;
