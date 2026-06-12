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

// Resolve the model name for a table within an explicit namespace coordinate,
// reading the per-namespace domain block rather than the flat model map.
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

// Resolve the field name for a column within an explicit namespace coordinate.
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
// Each column resolves through `ComputeColumnJsType` with the coordinate, so
// refined per-namespace output types (e.g. `Vector<N>`) are preserved and
// same-named tables across namespaces resolve to each namespace's own columns.
// `ComputeColumnJsType`'s constraint is the minimal `ColumnResolutionContract`,
// which `TableProxyContract` satisfies, so `C` is indexed directly — no
// `C extends Contract<SqlStorage>` guard.
type ResolvedColumnTypes<
  C extends TableProxyContract,
  NsId extends string,
  TableName extends string,
> =
  NamespaceTable<C, NsId, TableName> extends infer Table extends StorageTable
    ? {
        [ColName in keyof Table['columns'] & string]: ComputeColumnJsType<
          C,
          NsId,
          TableName,
          ColName,
          ExtractCodecTypes<C>
        >;
      }
    : Record<string, never>;

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
              [K in keyof Table['columns']]?: FindFieldForColumn<
                C,
                NsId,
                ModelName,
                K & string
              > extends infer FieldName extends string
                ? FieldName extends keyof NsInputs[ModelName]
                  ? Table['columns'][K]['nullable'] extends true
                    ? NonNullable<NsInputs[ModelName][FieldName]> | null
                    : NonNullable<NsInputs[ModelName][FieldName]>
                  : Table['columns'][K]['codecId'] extends keyof CT
                    ? CT[Table['columns'][K]['codecId']]['input']
                    : unknown
                : Table['columns'][K]['codecId'] extends keyof CT
                  ? CT[Table['columns'][K]['codecId']]['input']
                  : unknown;
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
