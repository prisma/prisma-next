import type {
  ExtractCodecTypes,
  ExtractQueryOperationTypes,
  StorageTable,
} from '@prisma-next/sql-contract/types';
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
  DefaultScope,
  EmptyRow,
  Expand,
  JoinOuterScope,
  JoinSource,
  MergeScopes,
  NullableScope,
  QueryContext,
  Scope,
  ScopeField,
  ScopeTable,
  StorageTableToScopeTable,
  Subquery,
} from './scope';

export type CapabilitiesBase = Record<string, Record<string, boolean>>;

export type Db<C extends TableProxyContract> = {
  [Name in string & keyof C['storage']['tables']]: TableProxy<C, Name>;
};

type ContractToQC<C extends TableProxyContract> = {
  readonly codecTypes: ExtractCodecTypes<C>;
  readonly capabilities: C['capabilities'];
  readonly queryOperationTypes: ExtractQueryOperationTypes<C>;
};

export interface LateralBuilder<QC extends QueryContext, ParentScope extends Scope> {
  from<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
  ): SelectQuery<QC, MergeScopes<ParentScope, Other[typeof JoinOuterScope]>, EmptyRow>;
}

export interface WithJoin<QC extends QueryContext, AvailableScope extends Scope> {
  innerJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>>;

  outerLeftJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<AvailableScope, NullableScope<Other[typeof JoinOuterScope]>>>;

  outerRightJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<NullableScope<AvailableScope>, Other[typeof JoinOuterScope]>>;

  outerFullJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<
    QC,
    MergeScopes<NullableScope<AvailableScope>, NullableScope<Other[typeof JoinOuterScope]>>
  >;
}

export interface WithLateralJoin<QC extends QueryContext, AvailableScope extends Scope> {
  lateralJoin<Alias extends string, LateralRow extends Record<string, ScopeField>>(
    alias: Alias,
    builder: (lateral: LateralBuilder<QC, AvailableScope>) => Subquery<LateralRow>,
  ): JoinedTables<
    QC,
    MergeScopes<AvailableScope, { topLevel: LateralRow; namespaces: Record<Alias, LateralRow> }>
  >;

  outerLateralJoin<Alias extends string, LateralRow extends Record<string, ScopeField>>(
    alias: Alias,
    builder: (lateral: LateralBuilder<QC, AvailableScope>) => Subquery<LateralRow>,
  ): JoinedTables<
    QC,
    MergeScopes<
      AvailableScope,
      NullableScope<{ topLevel: LateralRow; namespaces: Record<Alias, LateralRow> }>
    >
  >;
}

export interface WithSelect<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField> = EmptyRow,
> {
  select<Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
    ...columns: Columns
  ): SelectQuery<QC, AvailableScope, WithFields<RowType, AvailableScope['topLevel'], Columns>>;

  select<Alias extends string, Field extends ScopeField>(
    alias: Alias,
    expr: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Expression<Field>,
  ): SelectQuery<QC, AvailableScope, WithField<RowType, Field, Alias>>;

  select<Result extends Record<string, Expression<ScopeField>>>(
    callback: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Result,
  ): SelectQuery<QC, AvailableScope, Expand<RowType & ExtractScopeFields<Result>>>;
}

interface JoinedTablesBaseline<QC extends QueryContext, AvailableScope extends Scope>
  extends WithJoin<QC, AvailableScope>,
    WithSelect<QC, AvailableScope, EmptyRow> {}

export type JoinedTables<
  QC extends QueryContext,
  AvailableScope extends Scope,
> = JoinedTablesBaseline<QC, AvailableScope> &
  CapabilityGated<
    QC['capabilities'],
    { sql: { lateral: true } },
    WithLateralJoin<QC, AvailableScope>
  >;

type TableProxyContract = {
  readonly storage: { readonly tables: Record<string, StorageTable> };
  readonly capabilities: CapabilitiesBase;
};

interface TableProxyBaseline<
  C extends TableProxyContract,
  Name extends string & keyof C['storage']['tables'],
  Alias extends string = Name,
  AvailableScope extends Scope = DefaultScope<Name, C['storage']['tables'][Name]>,
  QC extends QueryContext = ContractToQC<C>,
> extends JoinSource<StorageTableToScopeTable<C['storage']['tables'][Name]>, Alias>,
    WithJoin<QC, AvailableScope>,
    WithSelect<QC, AvailableScope, EmptyRow> {
  as<NewAlias extends string>(newAlias: NewAlias): TableProxy<C, Name, NewAlias, AvailableScope>;
}

export type TableProxy<
  C extends TableProxyContract,
  Name extends string & keyof C['storage']['tables'],
  Alias extends string = Name,
  AvailableScope extends Scope = DefaultScope<Name, C['storage']['tables'][Name]>,
  QC extends QueryContext = ContractToQC<C>,
> = TableProxyBaseline<C, Name, Alias, AvailableScope, QC> &
  CapabilityGated<
    C['capabilities'],
    { sql: { lateral: true } },
    WithLateralJoin<QC, AvailableScope>
  >;

export interface WithDistinct {
  distinct(): this;
}

export interface WithDistinctOn<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> {
  distinctOn(...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]): this;

  distinctOn(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC>,
    ) => Expression<ScopeField>,
  ): this;
}

export interface WithPagination<QC extends QueryContext, AvailableScope extends Scope> {
  limit(count: number): this;
  limit(
    expr: (fields: FieldProxy<AvailableScope>, fns: Functions<QC>) => Expression<ScopeField>,
  ): this;

  offset(count: number): this;
  offset(
    expr: (fields: FieldProxy<AvailableScope>, fns: Functions<QC>) => Expression<ScopeField>,
  ): this;
}

export interface WithAlias<RowType extends Record<string, ScopeField>> {
  as<Alias extends string>(newAlias: Alias): JoinSource<RowType, Alias>;
}

export interface WithExecution<
  QC extends QueryContext,
  RowType extends Record<string, ScopeField>,
> {
  first(): Promise<ResolveRow<RowType, QC['codecTypes']> | null>;
  firstOrThrow(): Promise<ResolveRow<RowType, QC['codecTypes']>>;
  all(): AsyncIterable<ResolveRow<RowType, QC['codecTypes']>>;
}

interface SelectQueryBaseline<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> extends WithSelect<QC, AvailableScope, RowType>,
    WithDistinct,
    WithPagination<QC, AvailableScope>,
    WithAlias<RowType>,
    WithExecution<QC, RowType>,
    Subquery<RowType> {
  where(expr: ExpressionBuilder<AvailableScope, QC>): SelectQuery<QC, AvailableScope, RowType>;

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): SelectQuery<QC, AvailableScope, RowType>;

  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): SelectQuery<QC, AvailableScope, RowType>;

  groupBy(
    ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
  ): GroupedQuery<QC, AvailableScope, RowType>;

  groupBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC>,
    ) => Expression<ScopeField>,
  ): GroupedQuery<QC, AvailableScope, RowType>;
}

export type SelectQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> = SelectQueryBaseline<QC, AvailableScope, RowType> &
  CapabilityGated<
    QC['capabilities'],
    { postgres: { distinctOn: true } },
    WithDistinctOn<QC, AvailableScope, RowType>
  >;

interface GroupedQueryBaseline<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> extends WithDistinct,
    WithPagination<QC, AvailableScope>,
    WithAlias<RowType>,
    WithExecution<QC, RowType>,
    Subquery<RowType> {
  groupBy(
    ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
  ): GroupedQuery<QC, AvailableScope, RowType>;

  groupBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC>,
    ) => Expression<ScopeField>,
  ): GroupedQuery<QC, AvailableScope, RowType>;

  having(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: AggregateFunctions<QC>,
    ) => Expression<BooleanCodecType>,
  ): GroupedQuery<QC, AvailableScope, RowType>;

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): GroupedQuery<QC, AvailableScope, RowType>;

  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: AggregateFunctions<QC>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): GroupedQuery<QC, AvailableScope, RowType>;
}

export type GroupedQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> = GroupedQueryBaseline<QC, AvailableScope, RowType> &
  CapabilityGated<
    QC['capabilities'],
    { postgres: { distinctOn: true } },
    WithDistinctOn<QC, AvailableScope, RowType>
  >;
