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

export interface LateralBuilder<CodecTypes extends CodecTypesBase, ParentScope extends Scope> {
  from<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
  ): SelectQuery<CodecTypes, MergeScopes<ParentScope, Other[typeof JoinOuterScope]>, EmptyRow>;
}

export interface WithJoin<CodecTypes extends CodecTypesBase, AvailableScope extends Scope> {
  innerJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, CodecTypes>,
  ): JoinedTables<CodecTypes, MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>>;

  outerLeftJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, CodecTypes>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<AvailableScope, NullableScope<Other[typeof JoinOuterScope]>>
  >;

  outerRightJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, CodecTypes>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<NullableScope<AvailableScope>, Other[typeof JoinOuterScope]>
  >;

  outerFullJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, CodecTypes>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<NullableScope<AvailableScope>, NullableScope<Other[typeof JoinOuterScope]>>
  >;

  lateralJoin<Alias extends string, LateralRow extends Record<string, ScopeField>>(
    alias: Alias,
    builder: (
      lateral: LateralBuilder<CodecTypes, AvailableScope>,
    ) => SelectQuery<CodecTypes, Scope, LateralRow>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<AvailableScope, { topLevel: LateralRow; namespaces: Record<Alias, LateralRow> }>
  >;

  outerLateralJoin<Alias extends string, LateralRow extends Record<string, ScopeField>>(
    alias: Alias,
    builder: (
      lateral: LateralBuilder<CodecTypes, AvailableScope>,
    ) => SelectQuery<CodecTypes, Scope, LateralRow>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<
      AvailableScope,
      NullableScope<{ topLevel: LateralRow; namespaces: Record<Alias, LateralRow> }>
    >
  >;
}

export interface WithSelect<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField> = EmptyRow,
> {
  select<Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
    ...columns: Columns
  ): SelectQuery<
    CodecTypes,
    AvailableScope,
    WithFields<RowType, AvailableScope['topLevel'], Columns>
  >;

  select<Alias extends string, Field extends ScopeField>(
    alias: Alias,
    expr: (
      fields: FieldProxy<AvailableScope>,
      fns: AggregateFunctions<CodecTypes>,
    ) => Expression<Field>,
  ): SelectQuery<CodecTypes, AvailableScope, WithField<RowType, Field, Alias>>;

  select<Result extends Record<string, Expression<ScopeField>>>(
    callback: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<CodecTypes>) => Result,
  ): SelectQuery<CodecTypes, AvailableScope, Expand<RowType & ExtractScopeFields<Result>>>;
}

export interface JoinedTables<CodecTypes extends CodecTypesBase, AvailableScope extends Scope>
  extends WithJoin<CodecTypes, AvailableScope>,
    WithSelect<CodecTypes, AvailableScope> {}

export interface TableProxy<
  CodecTypes extends CodecTypesBase,
  Name extends string,
  Table extends StorageTable,
  Alias extends string = Name,
  AvailableScope extends Scope = DefaultScope<Name, Table>,
> extends JoinSource<StorageTableToScopeTable<Table>, Alias>,
    WithJoin<CodecTypes, AvailableScope>,
    WithSelect<CodecTypes, AvailableScope> {
  as<Alias extends string>(
    newAlias: Alias,
  ): TableProxy<CodecTypes, Name, Table, Alias, AvailableScope>;
}

export interface WithDistinct<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> {
  distinct(): this;

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

export interface SelectQuery<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> extends WithSelect<CodecTypes, AvailableScope, RowType>,
    WithDistinct<CodecTypes, AvailableScope, RowType>,
    WithPagination<CodecTypes, AvailableScope>,
    WithAlias<RowType>,
    WithExecution<CodecTypes, RowType>,
    Subquery<RowType> {
  where(
    expr: ExpressionBuilder<AvailableScope, CodecTypes>,
  ): SelectQuery<CodecTypes, AvailableScope, RowType>;

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): SelectQuery<CodecTypes, AvailableScope, RowType>;

  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<CodecTypes>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): SelectQuery<CodecTypes, AvailableScope, RowType>;

  groupBy(
    ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
  ): GroupedQuery<CodecTypes, AvailableScope, RowType>;

  groupBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<CodecTypes>,
    ) => Expression<ScopeField>,
  ): GroupedQuery<CodecTypes, AvailableScope, RowType>;
}

export interface GroupedQuery<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> extends WithDistinct<CodecTypes, AvailableScope, RowType>,
    WithPagination<CodecTypes, AvailableScope>,
    WithAlias<RowType>,
    WithExecution<CodecTypes, RowType>,
    Subquery<RowType> {
  groupBy(
    ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
  ): GroupedQuery<CodecTypes, AvailableScope, RowType>;

  groupBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<CodecTypes>,
    ) => Expression<ScopeField>,
  ): GroupedQuery<CodecTypes, AvailableScope, RowType>;

  having(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: AggregateFunctions<CodecTypes>,
    ) => Expression<BooleanCodecType>,
  ): GroupedQuery<CodecTypes, AvailableScope, RowType>;

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): GroupedQuery<CodecTypes, AvailableScope, RowType>;

  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: AggregateFunctions<CodecTypes>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): GroupedQuery<CodecTypes, AvailableScope, RowType>;
}
