import type {
  AnnotationValue,
  OperationKind,
  ValidAnnotations,
} from '@prisma-next/framework-components/runtime';
import type {
  Expression,
  ExpressionBuilder,
  FieldProxy,
  Functions,
  OrderByOptions,
  OrderByScope,
  RawSqlTag,
} from '../expression';
import type { GatedMethod, QueryContext, Scope, ScopeField, Subquery } from '../scope';
import type { GroupedQuery } from './grouped-query';
import type { WithAlias, WithBuild, WithDistinct, WithPagination, WithSelect } from './shared';

export interface SelectQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
  RS extends RawSqlTag | undefined = undefined,
> extends Subquery<RowType>,
    WithSelect<QC, AvailableScope, RowType, RS>,
    WithPagination<QC>,
    WithDistinct,
    WithAlias<RowType>,
    WithBuild<QC, RowType> {
  /**
   * Attach one or more read-typed annotations to this query plan.
   * Annotations declare `applicableTo: ['read']` (or `['read', 'write']`)
   * via `defineAnnotation`; write-only annotations fail to compile here.
   * Annotations are merged into `plan.meta.annotations` at `.build()` time.
   * Chainable in any position; multiple calls compose with last-write-wins
   * on duplicate namespaces.
   */
  annotate<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
    ...annotations: As & ValidAnnotations<'read', As>
  ): SelectQuery<QC, AvailableScope, RowType, RS>;

  where(
    expr: ExpressionBuilder<AvailableScope, QC, RS>,
  ): SelectQuery<QC, AvailableScope, RowType, RS>;

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): SelectQuery<QC, AvailableScope, RowType, RS>;

  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC, RS>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): SelectQuery<QC, AvailableScope, RowType, RS>;

  groupBy(
    ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
  ): GroupedQuery<QC, AvailableScope, RowType, RS>;

  groupBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC, RS>,
    ) => Expression<ScopeField>,
  ): GroupedQuery<QC, AvailableScope, RowType, RS>;

  distinctOn: GatedMethod<
    QC['capabilities'],
    { postgres: { distinctOn: true } },
    {
      (
        ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
      ): SelectQuery<QC, AvailableScope, RowType, RS>;
      (
        expr: (
          fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
          fns: Functions<QC, RS>,
        ) => Expression<ScopeField>,
      ): SelectQuery<QC, AvailableScope, RowType, RS>;
    }
  >;
}
