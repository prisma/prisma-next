import type {
  AnnotationBuilder,
  AnnotationValue,
  OperationKind,
} from '@prisma-next/framework-components/runtime';
import type {
  AggregateFunctions,
  BooleanCodecType,
  Expression,
  FieldProxy,
  Functions,
  OrderByOptions,
  OrderByScope,
} from '../expression';
import type { GatedMethod, QueryContext, Scope, ScopeField, Subquery } from '../scope';
import type { WithAlias, WithBuild, WithDistinct, WithPagination } from './shared';

export interface GroupedQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
  Registry = {},
> extends Subquery<RowType>,
    WithPagination,
    WithDistinct,
    WithAlias<RowType>,
    WithBuild<QC, RowType> {
  /**
   * Attach user annotations via a registry-driven callback.
   * See `SelectQuery.annotate` for semantics; the same `'read'`-filtered
   * `AnnotationBuilder<'read', Registry>` is supplied here.
   */
  annotate(
    fn: (
      meta: AnnotationBuilder<'read', Registry>,
    ) => AnnotationBuilder<'read', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): GroupedQuery<QC, AvailableScope, RowType, Registry>;

  groupBy(
    ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
  ): GroupedQuery<QC, AvailableScope, RowType, Registry>;

  groupBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC>,
    ) => Expression<ScopeField>,
  ): GroupedQuery<QC, AvailableScope, RowType, Registry>;

  having(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: AggregateFunctions<QC>,
    ) => Expression<BooleanCodecType>,
  ): GroupedQuery<QC, AvailableScope, RowType, Registry>;

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): GroupedQuery<QC, AvailableScope, RowType, Registry>;

  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: AggregateFunctions<QC>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): GroupedQuery<QC, AvailableScope, RowType, Registry>;

  distinctOn: GatedMethod<
    QC['capabilities'],
    { postgres: { distinctOn: true } },
    {
      (
        ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
      ): GroupedQuery<QC, AvailableScope, RowType, Registry>;
      (
        expr: (
          fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
          fns: Functions<QC>,
        ) => Expression<ScopeField>,
      ): GroupedQuery<QC, AvailableScope, RowType, Registry>;
    }
  >;
}
