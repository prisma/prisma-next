import type {
  ExtractCodecTypes,
  ExtractFieldInputTypes,
  ExtractQueryOperationTypes,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import type { ComputeColumnJsType } from '@prisma-next/sql-relational-core/types';
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
import type { NamespaceTable, TableProxyContract } from './db';
import type { DeleteQuery, InsertQuery, InsertValues, UpdateQuery } from './mutation-query';
import type { WithJoin, WithSelect } from './shared';

type FindModelForTable<
  C extends TableProxyContract,
  NsId extends string,
  TableName extends string,
> = C['domain']['namespaces'][NsId]['models'] extends infer Models extends Record<string, unknown>
  ? {
      [M in keyof Models & string]: Models[M] extends {
        readonly storage: { readonly table: TableName };
      }
        ? M
        : never;
    }[keyof Models & string]
  : never;

type FindFieldForColumn<
  C extends TableProxyContract,
  NsId extends string,
  ModelName extends string,
  ColumnName extends string,
> = C['domain']['namespaces'][NsId]['models'] extends infer Models extends Record<string, unknown>
  ? ModelName extends keyof Models
    ? Models[ModelName] extends {
        readonly storage: { readonly fields: infer Fields extends Record<string, unknown> };
      }
      ? {
          [F in keyof Fields & string]: Fields[F] extends { readonly column: ColumnName }
            ? F
            : never;
        }[keyof Fields & string]
      : never
    : never
  : never;

// The select-result row's column types for a table at a namespace coordinate.
// The query lane types an enum column from the column's OWN storage `valueSet`
// ref (spec §5; TML-2886) — resolved here via {@link ColumnValueSetUnion} with
// column nullability applied. Every other column delegates to
// `ComputeColumnJsType` with the namespace coordinate, so refined per-namespace
// output types (e.g. `Vector<N>`) are preserved and same-named tables across
// namespaces resolve to each namespace's own columns. `ComputeColumnJsType`'s
// constraint is the minimal `ColumnResolutionContract`, which
// `TableProxyContract` satisfies, so `C` is indexed directly.
type ResolvedColumnTypes<
  C extends TableProxyContract,
  NsId extends string,
  TableName extends string,
> =
  NamespaceTable<C, NsId, TableName> extends infer Table extends StorageTable
    ? {
        [ColName in keyof Table['columns'] & string]: [
          ColumnValueSetUnion<C, Table['columns'][ColName]>,
        ] extends [never]
          ? ComputeColumnJsType<C, NsId, TableName, ColName, ExtractCodecTypes<C>>
          : Table['columns'][ColName]['nullable'] extends true
            ? ColumnValueSetUnion<C, Table['columns'][ColName]> | null
            : ColumnValueSetUnion<C, Table['columns'][ColName]>;
      }
    : Record<string, never>;

/**
 * Resolves a storage column's own `valueSet` ref to the value union of the
 * referenced storage value-set, or `never` when the column has no ref or the
 * ref does not resolve. Intra-plane, indexed off
 * `storage.namespaces[ns].entries.valueSet` by the ref's own namespace
 * coordinate. The write path accepts the same enum value union the read path
 * narrows to (TML-2886 — enum typing is ref-only on the emitted contract).
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

/**
 * Input type for a single column on the write path. Follows the column's own
 * storage `valueSet` ref to its enum value union when present (emitted flow);
 * else the namespace-nested baked `FieldInputTypes[NsId][Model][Field]` entry
 * (keeps value-objects / parameterized codecs / unions, and carries the enum
 * union in the no-emit flow where the storage column has no literal ref); else
 * the codec input. Column nullability applied in every branch.
 */
type ResolvedInsertColumn<
  C extends TableProxyContract,
  NsId extends string,
  Table extends StorageTable,
  ColName extends keyof Table['columns'],
  CT extends Record<string, { readonly input: unknown }>,
  NsInputs extends Record<string, Record<string, unknown>>,
  ModelName extends string,
> = [ColumnValueSetUnion<C, Table['columns'][ColName]>] extends [never]
  ? FindFieldForColumn<C, NsId, ModelName, ColName & string> extends infer FieldName extends string
    ? FieldName extends keyof NsInputs[ModelName & keyof NsInputs]
      ? Table['columns'][ColName]['nullable'] extends true
        ? NonNullable<NsInputs[ModelName & keyof NsInputs][FieldName]> | null
        : NonNullable<NsInputs[ModelName & keyof NsInputs][FieldName]>
      : Table['columns'][ColName]['codecId'] extends keyof CT
        ? CT[Table['columns'][ColName]['codecId']]['input']
        : unknown
    : Table['columns'][ColName]['codecId'] extends keyof CT
      ? CT[Table['columns'][ColName]['codecId']]['input']
      : unknown
  : Table['columns'][ColName]['nullable'] extends true
    ? ColumnValueSetUnion<C, Table['columns'][ColName]> | null
    : ColumnValueSetUnion<C, Table['columns'][ColName]>;

type ResolvedInsertValues<
  C extends TableProxyContract,
  NsId extends string,
  Table extends StorageTable,
  TableName extends string,
  CT extends Record<string, { readonly input: unknown }>,
  FieldInputs extends Record<string, Record<string, Record<string, unknown>>>,
> = string extends keyof FieldInputs
  ? InsertValues<Table, CT>
  : NsId extends keyof FieldInputs
    ? FieldInputs[NsId] extends infer NsInputs extends Record<string, Record<string, unknown>>
      ? FindModelForTable<C, NsId, TableName> extends infer ModelName extends string
        ? ModelName extends keyof NsInputs
          ? {
              [K in keyof Table['columns']]?: ResolvedInsertColumn<
                C,
                NsId,
                Table,
                K,
                CT,
                NsInputs,
                ModelName
              >;
            }
          : InsertValues<Table, CT>
        : InsertValues<Table, CT>
      : InsertValues<Table, CT>
    : InsertValues<Table, CT>;

type ResolvedUpdateValues<
  C extends TableProxyContract,
  NsId extends string,
  Table extends StorageTable,
  TableName extends string,
  CT extends Record<string, { readonly input: unknown }>,
  FieldInputs extends Record<string, Record<string, Record<string, unknown>>>,
> = ResolvedInsertValues<C, NsId, Table, TableName, CT, FieldInputs>;

type ResolvedUpdateExpressions<Table extends StorageTable> = {
  [K in keyof Table['columns']]?: Expression<{
    codecId: Table['columns'][K]['codecId'];
    nullable: boolean;
  }>;
};

export type ContractToQC<
  C extends TableProxyContract,
  NsId extends string = string,
  Name extends string = string,
> = {
  readonly codecTypes: ExtractCodecTypes<C>;
  readonly capabilities: C['capabilities'];
  readonly queryOperationTypes: ExtractQueryOperationTypes<C>;
  readonly resolvedColumnOutputTypes: ResolvedColumnTypes<C, NsId, Name>;
};

export interface TableProxy<
  C extends TableProxyContract,
  NsId extends string,
  Name extends string,
  Alias extends string = Name,
  AvailableScope extends Scope = DefaultScope<Name, NamespaceTable<C, NsId, Name>>,
  QC extends QueryContext = ContractToQC<C, NsId, Name>,
> extends JoinSource<StorageTableToScopeTable<NamespaceTable<C, NsId, Name>>, Alias>,
    WithSelect<QC, AvailableScope, EmptyRow>,
    WithJoin<QC, AvailableScope, C['capabilities']> {
  as<NewAlias extends string>(
    newAlias: NewAlias,
  ): TableProxy<C, NsId, Name, NewAlias, RebindScope<AvailableScope, Alias, NewAlias>, QC>;

  insert(
    rows: ReadonlyArray<
      ResolvedInsertValues<
        C,
        NsId,
        NamespaceTable<C, NsId, Name>,
        Name,
        QC['codecTypes'],
        ExtractFieldInputTypes<C>
      >
    >,
  ): InsertQuery<QC, AvailableScope, EmptyRow>;

  update(
    set: ResolvedUpdateValues<
      C,
      NsId,
      NamespaceTable<C, NsId, Name>,
      Name,
      QC['codecTypes'],
      ExtractFieldInputTypes<C>
    >,
  ): UpdateQuery<QC, AvailableScope, EmptyRow>;

  update(
    callback: (
      fields: FieldProxy<AvailableScope>,
      fns: Functions<QC>,
    ) => ResolvedUpdateExpressions<NamespaceTable<C, NsId, Name>>,
  ): UpdateQuery<QC, AvailableScope, EmptyRow>;

  delete(): DeleteQuery<QC, AvailableScope, EmptyRow>;
}
