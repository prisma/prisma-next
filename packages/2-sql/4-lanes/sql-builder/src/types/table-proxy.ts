import type { Contract, ContractModelDefinitions } from '@prisma-next/contract/types';
import type {
  ExtractCodecTypes,
  ExtractFieldInputTypes,
  ExtractFieldOutputTypes,
  ExtractQueryOperationTypes,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import type { Expression, FieldProxy, Functions } from '../expression';
import type {
  DefaultScope,
  EmptyRow,
  JoinSource,
  QueryContext,
  RebindScope,
  Scope,
  StorageTableToScopeTable,
} from '../scope';
import type { TableProxyContract, UnboundTables } from './db';
import type { DeleteQuery, InsertQuery, InsertValues, UpdateQuery } from './mutation-query';
import type { WithJoin, WithSelect } from './shared';

/**
 * The literal columns of `table`, read straight off
 * `storage.namespaces[ns].entries.table[table].columns`. Going through
 * `UnboundTables` widens columns to the `StorageColumn` class shape and erases
 * the literal `valueSet` ref, so the ref-following path reads the columns here.
 * Unions the matching table's columns across every namespace that declares it.
 */
type LiteralColumnsOf<C extends TableProxyContract, TableName extends string> = {
  [NsId in keyof C['storage']['namespaces']]: C['storage']['namespaces'][NsId] extends {
    readonly entries: { readonly table: infer Tables };
  }
    ? TableName extends keyof Tables
      ? Tables[TableName] extends { readonly columns: infer Columns }
        ? Columns
        : never
      : never
    : never;
}[keyof C['storage']['namespaces']];

/**
 * Resolves a storage column's own `valueSet` ref to the value union of the
 * referenced storage value-set, or `never` when the column has no ref or the
 * ref does not resolve. Intra-plane, indexed off
 * `storage.namespaces[ns].entries.valueSet`.
 */
type ColumnValueSetUnion<C extends TableProxyContract, Col> = Col extends {
  readonly valueSet: {
    readonly namespaceId: infer NsId extends string;
    readonly entityName: infer Name extends string;
  };
}
  ? NsId extends keyof C['storage']['namespaces']
    ? C['storage']['namespaces'][NsId] extends {
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
 * The non-enum field output/input for a column, read from the still-baked
 * `FieldOutputTypes`/`FieldInputTypes` map (keyed by model/field). The map keeps
 * value-object, parameterized-codec, union, and plain-codec narrowings; in the
 * no-emit (`typeof contract`) flow it is also the only carrier of the enum value
 * union, since the authored object's storage column has no literal `valueSet`
 * ref. `never` when no model field maps to the column or the entry is absent.
 */
type BakedColumnType<
  C,
  TableName extends string,
  ColumnName extends string,
  FieldTypes extends Record<string, Record<string, unknown>>,
> = string extends keyof FieldTypes
  ? never
  : FindModelForTable<C, TableName> extends infer ModelName extends string
    ? ModelName extends keyof FieldTypes
      ? FindFieldForColumn<C, ModelName, ColumnName> extends infer FieldName extends string
        ? FieldName extends keyof FieldTypes[ModelName]
          ? FieldTypes[ModelName][FieldName]
          : never
        : never
      : never
    : never;

/**
 * Output type for one storage column on the query lane. Follows the column's
 * own storage `valueSet` ref when present (emitted flow); otherwise falls back
 * to the baked `FieldOutputTypes` entry (carries the enum union in the no-emit
 * flow, plus value-objects/parameterized codecs/unions); otherwise the codec
 * output. Column nullability applied in every branch.
 */
type ResolveColumnOutput<
  C extends TableProxyContract,
  TableName extends string,
  ColName extends string,
  Col,
> = [ColumnValueSetUnion<C, Col>] extends [never]
  ? [BakedColumnType<C, TableName, ColName, ExtractFieldOutputTypes<C>>] extends [never]
    ? Col extends { readonly codecId: infer CodecId extends string }
      ? CodecId extends keyof ExtractCodecTypes<C>
        ? Col extends { readonly nullable: true }
          ? ExtractCodecTypes<C>[CodecId]['output'] | null
          : ExtractCodecTypes<C>[CodecId]['output']
        : unknown
      : unknown
    : Col extends { readonly nullable: true }
      ? NonNullable<BakedColumnType<C, TableName, ColName, ExtractFieldOutputTypes<C>>> | null
      : BakedColumnType<C, TableName, ColName, ExtractFieldOutputTypes<C>>
  : Col extends { readonly nullable: true }
    ? ColumnValueSetUnion<C, Col> | null
    : ColumnValueSetUnion<C, Col>;

/**
 * Input type for one storage column on the write path. Same precedence as
 * {@link ResolveColumnOutput} but reading `FieldInputTypes` and codec `input`.
 */
type ResolveColumnInput<
  C extends TableProxyContract,
  TableName extends string,
  ColName extends string,
  Col,
  CT extends Record<string, { readonly input: unknown }>,
> = [ColumnValueSetUnion<C, Col>] extends [never]
  ? [BakedColumnType<C, TableName, ColName, ExtractFieldInputTypes<C>>] extends [never]
    ? Col extends { readonly codecId: infer CodecId extends string }
      ? CodecId extends keyof CT
        ? CT[CodecId]['input']
        : unknown
      : unknown
    : Col extends { readonly nullable: true }
      ? NonNullable<BakedColumnType<C, TableName, ColName, ExtractFieldInputTypes<C>>> | null
      : BakedColumnType<C, TableName, ColName, ExtractFieldInputTypes<C>>
  : Col extends { readonly nullable: true }
    ? ColumnValueSetUnion<C, Col> | null
    : ColumnValueSetUnion<C, Col>;

type ResolvedColumnTypes<C extends TableProxyContract, TableName extends string> =
  LiteralColumnsOf<C, TableName> extends infer Columns
    ? [Columns] extends [never]
      ? Record<string, never>
      : {
          [ColName in keyof Columns & string]: ResolveColumnOutput<
            C,
            TableName,
            ColName,
            Columns[ColName]
          >;
        }
    : Record<string, never>;

type ResolvedInsertValues<
  C extends TableProxyContract,
  Table extends StorageTable,
  TableName extends string,
  CT extends Record<string, { readonly input: unknown }>,
> =
  LiteralColumnsOf<C, TableName> extends infer Columns
    ? [Columns] extends [never]
      ? InsertValues<Table, CT>
      : {
          [ColName in keyof Columns & string]?: ResolveColumnInput<
            C,
            TableName,
            ColName,
            Columns[ColName],
            CT
          >;
        }
    : InsertValues<Table, CT>;

type ResolvedUpdateValues<
  C extends TableProxyContract,
  Table extends StorageTable,
  TableName extends string,
  CT extends Record<string, { readonly input: unknown }>,
> = ResolvedInsertValues<C, Table, TableName, CT>;

type ResolvedUpdateExpressions<Table extends StorageTable> = {
  [K in keyof Table['columns']]?: Expression<{
    codecId: Table['columns'][K]['codecId'];
    nullable: boolean;
  }>;
};

export type ContractToQC<C extends TableProxyContract, Name extends string = string> = {
  readonly codecTypes: ExtractCodecTypes<C>;
  readonly capabilities: C['capabilities'];
  readonly queryOperationTypes: ExtractQueryOperationTypes<C>;
  readonly resolvedColumnOutputTypes: ResolvedColumnTypes<C, Name>;
};

export interface TableProxy<
  C extends TableProxyContract,
  Name extends string & keyof UnboundTables<C>,
  Alias extends string = Name,
  AvailableScope extends Scope = DefaultScope<Name, UnboundTables<C>[Name]>,
  QC extends QueryContext = ContractToQC<C, Name>,
> extends JoinSource<StorageTableToScopeTable<UnboundTables<C>[Name]>, Alias>,
    WithSelect<QC, AvailableScope, EmptyRow>,
    WithJoin<QC, AvailableScope, C['capabilities']> {
  as<NewAlias extends string>(
    newAlias: NewAlias,
  ): TableProxy<C, Name, NewAlias, RebindScope<AvailableScope, Alias, NewAlias>, QC>;

  insert(
    rows: ReadonlyArray<ResolvedInsertValues<C, UnboundTables<C>[Name], Name, QC['codecTypes']>>,
  ): InsertQuery<QC, AvailableScope, EmptyRow>;

  update(
    set: ResolvedUpdateValues<C, UnboundTables<C>[Name], Name, QC['codecTypes']>,
  ): UpdateQuery<QC, AvailableScope, EmptyRow>;

  update(
    callback: (
      fields: FieldProxy<AvailableScope>,
      fns: Functions<QC>,
    ) => ResolvedUpdateExpressions<UnboundTables<C>[Name]>,
  ): UpdateQuery<QC, AvailableScope, EmptyRow>;

  delete(): DeleteQuery<QC, AvailableScope, EmptyRow>;
}
