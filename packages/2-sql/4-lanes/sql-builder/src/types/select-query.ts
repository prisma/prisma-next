import type {
  AnnotationBuilder,
  AnnotationValue,
  OperationKind,
} from '@prisma-next/framework-components/runtime';
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
import type { WithAlias, WithBuild, WithDistinct, WithPagination, WithSelect } from './shared';

export interface SelectQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
  Registry = {},
> extends Subquery<RowType>,
    WithSelect<QC, AvailableScope, RowType, Registry>,
    WithPagination,
    WithDistinct,
    WithAlias<RowType>,
    WithBuild<QC, RowType> {
  /**
   * Attach user annotations via a registry-driven callback.
   *
   * The callback receives `meta: AnnotationBuilder<'read', Registry>`
   * with one method per read-applicable annotation handle contributed by
   * the runtime's middleware. Methods produce branded `AnnotationValue`s
   * accumulated in the builder's `values` array. Callers may either
   * return the chained builder or a `readonly AnnotationValue[]` (the
   * array escape hatch) for ad-hoc handles imported directly.
   *
   * Write-only handles are filtered out of `meta` structurally; the
   * runtime gate (`assertAnnotationsApplicable`) catches cast-bypass.
   * Multiple `.annotate(...)` calls compose; duplicate namespaces use
   * last-write-wins.
   */
  annotate(
    fn: (
      meta: AnnotationBuilder<'read', Registry>,
    ) => AnnotationBuilder<'read', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): SelectQuery<QC, AvailableScope, RowType, Registry>;

  where(
    expr: ExpressionBuilder<AvailableScope, QC>,
  ): SelectQuery<QC, AvailableScope, RowType, Registry>;

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): SelectQuery<QC, AvailableScope, RowType, Registry>;

  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): SelectQuery<QC, AvailableScope, RowType, Registry>;

  groupBy(
    ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
  ): GroupedQuery<QC, AvailableScope, RowType, Registry>;

  groupBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC>,
    ) => Expression<ScopeField>,
  ): GroupedQuery<QC, AvailableScope, RowType, Registry>;

  distinctOn: GatedMethod<
    QC['capabilities'],
    { postgres: { distinctOn: true } },
    {
      (
        ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
      ): SelectQuery<QC, AvailableScope, RowType, Registry>;
      (
        expr: (
          fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
          fns: Functions<QC>,
        ) => Expression<ScopeField>,
      ): SelectQuery<QC, AvailableScope, RowType, Registry>;
    }
  >;
}
