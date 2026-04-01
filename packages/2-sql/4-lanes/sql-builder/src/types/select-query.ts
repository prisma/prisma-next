import type {
  Expression,
  ExpressionBuilder,
  FieldProxy,
  Functions,
  OrderByOptions,
  OrderByScope,
} from '../expression';
import type { GatedMethod, QueryContext, Scope, ScopeField, Subquery } from '../scope';
import type { GroupedQuery } from './grouped-query';
import type { WithAlias, WithDistinct, WithExecution, WithPagination, WithSelect } from './shared';

export interface SelectQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> extends Subquery<RowType>,
    WithSelect<QC, AvailableScope, RowType>,
    WithPagination,
    WithDistinct,
    WithAlias<RowType>,
    WithExecution<QC, RowType> {
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

  distinctOn: GatedMethod<
    QC['capabilities'],
    { postgres: { distinctOn: true } },
    {
      (
        ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
      ): SelectQuery<QC, AvailableScope, RowType>;
      (
        expr: (
          fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
          fns: Functions<QC>,
        ) => Expression<ScopeField>,
      ): SelectQuery<QC, AvailableScope, RowType>;
    }
  >;
}
