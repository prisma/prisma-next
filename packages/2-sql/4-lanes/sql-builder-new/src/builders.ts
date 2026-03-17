import type { StorageTable } from '@prisma-next/sql-contract/types';
import type {
  AggregateFunctions,
  BooleanCodecType,
  Expression,
  ExpressionBuilder,
  ExtractScopeFields,
  FieldProxy,
  Functions,
  OrderByOptions,
  OrderByScope,
  WithField,
  WithFields,
} from './expression';
import type { ResolveRow } from './resolve';
import type {
  CapabilityGated,
  CodecTypesBase,
  DefaultScope,
  EmptyRow,
  Expand,
  JoinOuterScope,
  JoinSource,
  MergeScopes,
  NullableScope,
  Scope,
  ScopeField,
  ScopeTable,
  StorageTableToScopeTable,
  Subquery,
} from './scope';

export type CapabilitiesBase = Record<string, Record<string, boolean>>;

export interface LateralBuilder<
  CodecTypes extends CodecTypesBase,
  ParentScope extends Scope,
  Capabilities extends CapabilitiesBase = CapabilitiesBase,
> {
  from<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
  ): SelectQuery<
    CodecTypes,
    MergeScopes<ParentScope, Other[typeof JoinOuterScope]>,
    EmptyRow,
    Capabilities
  >;
}

export interface WithJoin<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  Capabilities extends CapabilitiesBase = CapabilitiesBase,
> {
  innerJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, CodecTypes>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>,
    Capabilities
  >;

  outerLeftJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, CodecTypes>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<AvailableScope, NullableScope<Other[typeof JoinOuterScope]>>,
    Capabilities
  >;

  outerRightJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, CodecTypes>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<NullableScope<AvailableScope>, Other[typeof JoinOuterScope]>,
    Capabilities
  >;

  outerFullJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, CodecTypes>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<NullableScope<AvailableScope>, NullableScope<Other[typeof JoinOuterScope]>>,
    Capabilities
  >;
}

export interface WithLateralJoin<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  Capabilities extends CapabilitiesBase = CapabilitiesBase,
> {
  lateralJoin<Alias extends string, LateralRow extends Record<string, ScopeField>>(
    alias: Alias,
    builder: (
      lateral: LateralBuilder<CodecTypes, AvailableScope, Capabilities>,
    ) => Subquery<LateralRow>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<AvailableScope, { topLevel: LateralRow; namespaces: Record<Alias, LateralRow> }>,
    Capabilities
  >;

  outerLateralJoin<Alias extends string, LateralRow extends Record<string, ScopeField>>(
    alias: Alias,
    builder: (
      lateral: LateralBuilder<CodecTypes, AvailableScope, Capabilities>,
    ) => Subquery<LateralRow>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<
      AvailableScope,
      NullableScope<{ topLevel: LateralRow; namespaces: Record<Alias, LateralRow> }>
    >,
    Capabilities
  >;
}

export interface WithSelect<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField> = EmptyRow,
  Capabilities extends CapabilitiesBase = CapabilitiesBase,
> {
  select<Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
    ...columns: Columns
  ): SelectQuery<
    CodecTypes,
    AvailableScope,
    WithFields<RowType, AvailableScope['topLevel'], Columns>,
    Capabilities
  >;

  select<Alias extends string, Field extends ScopeField>(
    alias: Alias,
    expr: (
      fields: FieldProxy<AvailableScope>,
      fns: AggregateFunctions<CodecTypes>,
    ) => Expression<Field>,
  ): SelectQuery<CodecTypes, AvailableScope, WithField<RowType, Field, Alias>, Capabilities>;

  select<Result extends Record<string, Expression<ScopeField>>>(
    callback: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<CodecTypes>) => Result,
  ): SelectQuery<
    CodecTypes,
    AvailableScope,
    Expand<RowType & ExtractScopeFields<Result>>,
    Capabilities
  >;
}

interface JoinedTablesBaseline<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  Capabilities extends CapabilitiesBase = CapabilitiesBase,
> extends WithJoin<CodecTypes, AvailableScope, Capabilities>,
    WithSelect<CodecTypes, AvailableScope, EmptyRow, Capabilities> {}

export type JoinedTables<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  Capabilities extends CapabilitiesBase = CapabilitiesBase,
> = JoinedTablesBaseline<CodecTypes, AvailableScope, Capabilities> &
  CapabilityGated<
    Capabilities,
    { sql: { lateral: true } },
    WithLateralJoin<CodecTypes, AvailableScope, Capabilities>
  >;

interface TableProxyBaseline<
  CodecTypes extends CodecTypesBase,
  Name extends string,
  Table extends StorageTable,
  Alias extends string = Name,
  AvailableScope extends Scope = DefaultScope<Name, Table>,
  Capabilities extends CapabilitiesBase = CapabilitiesBase,
> extends JoinSource<StorageTableToScopeTable<Table>, Alias>,
    WithJoin<CodecTypes, AvailableScope, Capabilities>,
    WithSelect<CodecTypes, AvailableScope, EmptyRow, Capabilities> {
  as<NewAlias extends string>(
    newAlias: NewAlias,
  ): TableProxy<CodecTypes, Name, Table, NewAlias, AvailableScope, Capabilities>;
}

export type TableProxy<
  CodecTypes extends CodecTypesBase,
  Name extends string,
  Table extends StorageTable,
  Alias extends string = Name,
  AvailableScope extends Scope = DefaultScope<Name, Table>,
  Capabilities extends CapabilitiesBase = CapabilitiesBase,
> = TableProxyBaseline<CodecTypes, Name, Table, Alias, AvailableScope, Capabilities> &
  CapabilityGated<
    Capabilities,
    { sql: { lateral: true } },
    WithLateralJoin<CodecTypes, AvailableScope, Capabilities>
  >;

export interface WithDistinct {
  distinct(): this;
}

export interface WithDistinctOn<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> {
  distinctOn(...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]): this;

  distinctOn(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<CodecTypes>,
    ) => Expression<ScopeField>,
  ): this;
}

export interface WithPagination<CodecTypes extends CodecTypesBase, AvailableScope extends Scope> {
  limit(count: number): this;
  limit(
    expr: (
      fields: FieldProxy<AvailableScope>,
      fns: Functions<CodecTypes>,
    ) => Expression<ScopeField>,
  ): this;

  offset(count: number): this;
  offset(
    expr: (
      fields: FieldProxy<AvailableScope>,
      fns: Functions<CodecTypes>,
    ) => Expression<ScopeField>,
  ): this;
}

export interface WithAlias<RowType extends Record<string, ScopeField>> {
  as<Alias extends string>(newAlias: Alias): JoinSource<RowType, Alias>;
}

export interface WithExecution<
  CodecTypes extends CodecTypesBase,
  RowType extends Record<string, ScopeField>,
> {
  first(): Promise<ResolveRow<RowType, CodecTypes>>;
}

interface SelectQueryBaseline<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
  Capabilities extends CapabilitiesBase = CapabilitiesBase,
> extends WithSelect<CodecTypes, AvailableScope, RowType, Capabilities>,
    WithDistinct,
    WithPagination<CodecTypes, AvailableScope>,
    WithAlias<RowType>,
    WithExecution<CodecTypes, RowType>,
    Subquery<RowType> {
  where(
    expr: ExpressionBuilder<AvailableScope, CodecTypes>,
  ): SelectQuery<CodecTypes, AvailableScope, RowType, Capabilities>;

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): SelectQuery<CodecTypes, AvailableScope, RowType, Capabilities>;

  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<CodecTypes>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): SelectQuery<CodecTypes, AvailableScope, RowType, Capabilities>;

  groupBy(
    ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
  ): GroupedQuery<CodecTypes, AvailableScope, RowType, Capabilities>;

  groupBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<CodecTypes>,
    ) => Expression<ScopeField>,
  ): GroupedQuery<CodecTypes, AvailableScope, RowType, Capabilities>;
}

export type SelectQuery<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
  Capabilities extends CapabilitiesBase = CapabilitiesBase,
> = SelectQueryBaseline<CodecTypes, AvailableScope, RowType, Capabilities> &
  CapabilityGated<
    Capabilities,
    { postgres: { distinctOn: true } },
    WithDistinctOn<CodecTypes, AvailableScope, RowType>
  >;

interface GroupedQueryBaseline<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
  Capabilities extends CapabilitiesBase = CapabilitiesBase,
> extends WithDistinct,
    WithPagination<CodecTypes, AvailableScope>,
    WithAlias<RowType>,
    WithExecution<CodecTypes, RowType>,
    Subquery<RowType> {
  groupBy(
    ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
  ): GroupedQuery<CodecTypes, AvailableScope, RowType, Capabilities>;

  groupBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<CodecTypes>,
    ) => Expression<ScopeField>,
  ): GroupedQuery<CodecTypes, AvailableScope, RowType, Capabilities>;

  having(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: AggregateFunctions<CodecTypes>,
    ) => Expression<BooleanCodecType>,
  ): GroupedQuery<CodecTypes, AvailableScope, RowType, Capabilities>;

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): GroupedQuery<CodecTypes, AvailableScope, RowType, Capabilities>;

  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: AggregateFunctions<CodecTypes>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): GroupedQuery<CodecTypes, AvailableScope, RowType, Capabilities>;
}

export type GroupedQuery<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
  Capabilities extends CapabilitiesBase = CapabilitiesBase,
> = GroupedQueryBaseline<CodecTypes, AvailableScope, RowType, Capabilities> &
  CapabilityGated<
    Capabilities,
    { postgres: { distinctOn: true } },
    WithDistinctOn<CodecTypes, AvailableScope, RowType>
  >;
