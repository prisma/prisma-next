import type { StorageTable } from '@prisma-next/sql-contract/types';
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
> {
  returning: GatedMethod<
    QC['capabilities'],
    ReturningCapability,
    <Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
      ...columns: Columns
    ) => InsertQuery<QC, AvailableScope, WithFields<EmptyRow, AvailableScope['topLevel'], Columns>>
  >;
  first(): Promise<ResolveRow<RowType, QC['codecTypes']> | null>;
  firstOrThrow(): Promise<ResolveRow<RowType, QC['codecTypes']>>;
  all(): AsyncIterable<ResolveRow<RowType, QC['codecTypes']>>;
}

export interface UpdateQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> {
  where(expr: ExpressionBuilder<AvailableScope, QC>): UpdateQuery<QC, AvailableScope, RowType>;
  returning: GatedMethod<
    QC['capabilities'],
    ReturningCapability,
    <Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
      ...columns: Columns
    ) => UpdateQuery<QC, AvailableScope, WithFields<EmptyRow, AvailableScope['topLevel'], Columns>>
  >;
  first(): Promise<ResolveRow<RowType, QC['codecTypes']> | null>;
  firstOrThrow(): Promise<ResolveRow<RowType, QC['codecTypes']>>;
  all(): AsyncIterable<ResolveRow<RowType, QC['codecTypes']>>;
}

export interface DeleteQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> {
  where(expr: ExpressionBuilder<AvailableScope, QC>): DeleteQuery<QC, AvailableScope, RowType>;
  returning: GatedMethod<
    QC['capabilities'],
    ReturningCapability,
    <Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
      ...columns: Columns
    ) => DeleteQuery<QC, AvailableScope, WithFields<EmptyRow, AvailableScope['topLevel'], Columns>>
  >;
  first(): Promise<ResolveRow<RowType, QC['codecTypes']> | null>;
  firstOrThrow(): Promise<ResolveRow<RowType, QC['codecTypes']>>;
  all(): AsyncIterable<ResolveRow<RowType, QC['codecTypes']>>;
}
