import type {
  AnnotationBuilder,
  AnnotationValue,
  OperationKind,
} from '@prisma-next/framework-components/runtime';
import type { StorageTable } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { ExpressionBuilder, WithFields } from '../expression';
import type { ResolveRow } from '../resolve';
import type { EmptyRow, GatedMethod, QueryContext, Scope, ScopeField } from '../scope';

export type ReturningCapability = { sql: { returning: true } };

// Map table columns to their codec input types
export type InsertValues<
  Table extends StorageTable,
  CT extends Record<string, { readonly input: unknown }>,
> = {
  [K in keyof Table['columns']]?: Table['columns'][K]['codecId'] extends keyof CT
    ? CT[Table['columns'][K]['codecId']]['input']
    : unknown;
};

export type UpdateValues<
  Table extends StorageTable,
  CT extends Record<string, { readonly input: unknown }>,
> = {
  [K in keyof Table['columns']]?: Table['columns'][K]['codecId'] extends keyof CT
    ? CT[Table['columns'][K]['codecId']]['input']
    : unknown;
};

export interface InsertQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
  Registry = {},
> {
  /**
   * Attach user annotations via a registry-driven callback.
   *
   * The callback receives `meta: AnnotationBuilder<'write', Registry>`
   * with one method per write-applicable annotation handle contributed
   * by the runtime's middleware. Read-only handles are filtered out of
   * `meta` structurally; the runtime gate (`assertAnnotationsApplicable`)
   * catches cast-bypass. Multiple `.annotate(...)` calls compose;
   * duplicate namespaces use last-write-wins.
   */
  annotate(
    fn: (
      meta: AnnotationBuilder<'write', Registry>,
    ) => AnnotationBuilder<'write', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): InsertQuery<QC, AvailableScope, RowType, Registry>;
  returning: GatedMethod<
    QC['capabilities'],
    ReturningCapability,
    <Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
      ...columns: Columns
    ) => InsertQuery<
      QC,
      AvailableScope,
      WithFields<EmptyRow, AvailableScope['topLevel'], Columns>,
      Registry
    >
  >;
  build(): SqlQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>>;
}

export interface UpdateQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
  Registry = {},
> {
  /**
   * Attach user annotations via a registry-driven callback.
   * See `InsertQuery.annotate` for semantics.
   */
  annotate(
    fn: (
      meta: AnnotationBuilder<'write', Registry>,
    ) => AnnotationBuilder<'write', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): UpdateQuery<QC, AvailableScope, RowType, Registry>;
  where(
    expr: ExpressionBuilder<AvailableScope, QC>,
  ): UpdateQuery<QC, AvailableScope, RowType, Registry>;
  returning: GatedMethod<
    QC['capabilities'],
    ReturningCapability,
    <Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
      ...columns: Columns
    ) => UpdateQuery<
      QC,
      AvailableScope,
      WithFields<EmptyRow, AvailableScope['topLevel'], Columns>,
      Registry
    >
  >;
  build(): SqlQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>>;
}

export interface DeleteQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
  Registry = {},
> {
  /**
   * Attach user annotations via a registry-driven callback.
   * See `InsertQuery.annotate` for semantics.
   */
  annotate(
    fn: (
      meta: AnnotationBuilder<'write', Registry>,
    ) => AnnotationBuilder<'write', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): DeleteQuery<QC, AvailableScope, RowType, Registry>;
  where(
    expr: ExpressionBuilder<AvailableScope, QC>,
  ): DeleteQuery<QC, AvailableScope, RowType, Registry>;
  returning: GatedMethod<
    QC['capabilities'],
    ReturningCapability,
    <Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
      ...columns: Columns
    ) => DeleteQuery<
      QC,
      AvailableScope,
      WithFields<EmptyRow, AvailableScope['topLevel'], Columns>,
      Registry
    >
  >;
  build(): SqlQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>>;
}
