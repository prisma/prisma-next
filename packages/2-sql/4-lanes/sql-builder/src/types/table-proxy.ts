import type {
  ExtractCodecTypes,
  ExtractQueryOperationTypes,
  ExtractStorageColumnInputTypes,
  ExtractStorageColumnTypes,
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
import type { NamespaceTable, TableProxyContract } from './db';
import type { DeleteQuery, InsertQuery, InsertValues, UpdateQuery } from './mutation-query';
import type { WithJoin, WithSelect } from './shared';

// The storage-column type map for a single namespace/table coordinate, read
// with a single O(1) index into the emitted `StorageColumnTypes[ns][table]`
// (output) or `StorageColumnInputTypes[ns][table]` (input). Each entry already
// carries the full column type — parameterized-codec-refined codec type narrowed
// to the value-set literal union when present, with nullability applied — so the
// sql-builder storage surface needs no table→model / column→field walk.
//
// Resolves to `never` when the lookup is absent: either the empty default map a
// non-emitted (in-memory `defineContract`) contract carries — detected by
// `string extends keyof SCT`, the open index-signature key — or a coordinate not
// present in an emitted map.
type StorageColumnMapAt<
  SCT,
  NsId extends string,
  TableName extends string,
> = string extends keyof SCT
  ? never
  : NsId extends keyof SCT
    ? string extends keyof SCT[NsId]
      ? never
      : TableName extends keyof SCT[NsId]
        ? SCT[NsId][TableName]
        : never
    : never;

// The select-result row's column types for a table at a namespace coordinate,
// sourced directly from `StorageColumnTypes[ns][table]`. Same-named tables
// across namespaces resolve to each namespace's own columns because `NsId` is
// part of the coordinate; refined per-namespace output types (e.g. `Vector<N>`)
// are preserved because the storage map bakes them.
// A homomorphic mapped type over the resolved storage column map's keys, so the
// result is *always* structurally a `Record<string, unknown>` (satisfying
// `QueryContext['resolvedColumnOutputTypes']`) even while `C` is still generic.
// `ColumnKeys` is `string` when the coordinate is absent / the map is the empty
// default, yielding `Record<string, never>`.
type ResolvedColumnTypes<
  C extends TableProxyContract,
  NsId extends string,
  TableName extends string,
  ColMap = StorageColumnMapAt<ExtractStorageColumnTypes<C>, NsId, TableName>,
  ColumnKeys extends string = [ColMap] extends [never] ? never : keyof ColMap & string,
> = {
  readonly [K in ColumnKeys]: ColMap extends Record<K, unknown> ? ColMap[K] : never;
};

// The accepted insert/update shape for a table at a namespace coordinate: every
// column optional, typed from `StorageColumnInputTypes[ns][table]` (which bakes
// the value-set narrowing, codec input, and nullability). Falls back to the
// generic `InsertValues<Table, CT>` when the storage input map is absent.
type ResolvedInsertValues<
  C extends TableProxyContract,
  NsId extends string,
  Table extends StorageTable,
  TableName extends string,
  CT extends Record<string, { readonly input: unknown }>,
> =
  StorageColumnMapAt<ExtractStorageColumnInputTypes<C>, NsId, TableName> extends infer ColMap
    ? [ColMap] extends [never]
      ? InsertValues<Table, CT>
      : { [K in keyof ColMap]?: ColMap[K] }
    : InsertValues<Table, CT>;

type ResolvedUpdateValues<
  C extends TableProxyContract,
  NsId extends string,
  Table extends StorageTable,
  TableName extends string,
  CT extends Record<string, { readonly input: unknown }>,
> = ResolvedInsertValues<C, NsId, Table, TableName, CT>;

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
      ResolvedInsertValues<C, NsId, NamespaceTable<C, NsId, Name>, Name, QC['codecTypes']>
    >,
  ): InsertQuery<QC, AvailableScope, EmptyRow>;

  update(
    set: ResolvedUpdateValues<C, NsId, NamespaceTable<C, NsId, Name>, Name, QC['codecTypes']>,
  ): UpdateQuery<QC, AvailableScope, EmptyRow>;

  update(
    callback: (
      fields: FieldProxy<AvailableScope>,
      fns: Functions<QC>,
    ) => ResolvedUpdateExpressions<NamespaceTable<C, NsId, Name>>,
  ): UpdateQuery<QC, AvailableScope, EmptyRow>;

  delete(): DeleteQuery<QC, AvailableScope, EmptyRow>;
}
