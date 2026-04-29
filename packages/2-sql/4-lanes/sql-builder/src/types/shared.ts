import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type {
  AggregateFunctions,
  Expression,
  ExpressionBuilder,
  ExtractScopeFields,
  FieldProxy,
  WithField,
  WithFields,
} from '../expression';
import type { ResolveRow } from '../resolve';
import type {
  EmptyRow,
  Expand,
  GatedMethod,
  JoinOuterScope,
  JoinSource,
  MergeScopes,
  NullableScope,
  QueryContext,
  Scope,
  ScopeField,
  ScopeTable,
  Subquery,
} from '../scope';
import type { JoinedTables } from './joined-tables';
import type { SelectQuery } from './select-query';

export interface LateralBuilder<QC extends QueryContext, ParentScope extends Scope, Registry = {}> {
  from<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
  ): SelectQuery<QC, MergeScopes<ParentScope, Other[typeof JoinOuterScope]>, EmptyRow, Registry>;
}

export interface WithSelect<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField> = EmptyRow,
  Registry = {},
> {
  select<Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
    ...columns: Columns
  ): SelectQuery<
    QC,
    AvailableScope,
    WithFields<RowType, AvailableScope['topLevel'], Columns>,
    Registry
  >;

  select<Alias extends string, Field extends ScopeField>(
    alias: Alias,
    expr: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Expression<Field>,
  ): SelectQuery<QC, AvailableScope, WithField<RowType, Field, Alias>, Registry>;

  select<Result extends Record<string, Expression<ScopeField>>>(
    callback: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Result,
  ): SelectQuery<QC, AvailableScope, Expand<RowType & ExtractScopeFields<Result>>, Registry>;
}

export interface WithJoin<
  QC extends QueryContext,
  AvailableScope extends Scope,
  Capabilities,
  Registry = {},
> {
  innerJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, Registry>;

  outerLeftJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<
    QC,
    MergeScopes<AvailableScope, NullableScope<Other[typeof JoinOuterScope]>>,
    Registry
  >;

  outerRightJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<
    QC,
    MergeScopes<NullableScope<AvailableScope>, Other[typeof JoinOuterScope]>,
    Registry
  >;

  outerFullJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<
    QC,
    MergeScopes<NullableScope<AvailableScope>, NullableScope<Other[typeof JoinOuterScope]>>,
    Registry
  >;

  lateralJoin: GatedMethod<
    Capabilities,
    { sql: { lateral: true } },
    <Alias extends string, LateralRow extends Record<string, ScopeField>>(
      alias: Alias,
      builder: (lateral: LateralBuilder<QC, AvailableScope, Registry>) => Subquery<LateralRow>,
    ) => JoinedTables<
      QC,
      MergeScopes<AvailableScope, { topLevel: LateralRow; namespaces: Record<Alias, LateralRow> }>,
      Registry
    >
  >;

  outerLateralJoin: GatedMethod<
    Capabilities,
    { sql: { lateral: true } },
    <Alias extends string, LateralRow extends Record<string, ScopeField>>(
      alias: Alias,
      builder: (lateral: LateralBuilder<QC, AvailableScope, Registry>) => Subquery<LateralRow>,
    ) => JoinedTables<
      QC,
      MergeScopes<
        AvailableScope,
        NullableScope<{ topLevel: LateralRow; namespaces: Record<Alias, LateralRow> }>
      >,
      Registry
    >
  >;
}

export interface WithPagination {
  limit(count: number): this;
  offset(count: number): this;
}

export interface WithDistinct {
  distinct(): this;
}

export interface WithAlias<RowType extends Record<string, ScopeField>> {
  as<Alias extends string>(newAlias: Alias): JoinSource<RowType, Alias>;
}

export interface WithBuild<QC extends QueryContext, RowType extends Record<string, ScopeField>> {
  build(): SqlQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>>;
}
