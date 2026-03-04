import {
  createColumnRef,
  createDeleteAstBuilder,
  createInsertAstBuilder,
  createInsertOnConflictAstBuilder,
  createParamRef,
  createTableRef,
  createUpdateAstBuilder,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { buildOrmQueryPlan } from './query-plan-meta';
import { combineWhereFilters } from './where-utils';
import type { WhereExpr } from '@prisma-next/sql-relational-core/ast';

function resolveTableColumns(contract: SqlContract<SqlStorage>, tableName: string): string[] {
  const table = contract.storage.tables[tableName];
  if (!table) {
    throw new Error(`Unknown table "${tableName}" in SQL ORM query planner`);
  }
  return Object.keys(table.columns);
}

function buildReturningColumns(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  returningColumns: readonly string[] | undefined,
) {
  const columns =
    returningColumns && returningColumns.length > 0
      ? [...returningColumns]
      : resolveTableColumns(contract, tableName);

  return columns.map((column) => createColumnRef(tableName, column));
}

function toParamAssignments(
  values: Record<string, unknown>,
  startIndex = 1,
): {
  readonly assignments: Record<string, ReturnType<typeof createParamRef>>;
  readonly params: readonly unknown[];
} {
  const assignments: Record<string, ReturnType<typeof createParamRef>> = {};
  const params: unknown[] = [];
  let index = startIndex;

  for (const [column, value] of Object.entries(values)) {
    assignments[column] = createParamRef(index, column);
    params.push(value);
    index += 1;
  }

  return {
    assignments,
    params,
  };
}

export function compileInsertReturning(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  values: Record<string, unknown>,
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const { assignments, params } = toParamAssignments(values);
  const ast = createInsertAstBuilder(createTableRef(tableName))
    .values(assignments)
    .returning(buildReturningColumns(contract, tableName, returningColumns))
    .build();
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileInsertCount(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  values: Record<string, unknown>,
): SqlQueryPlan<Record<string, unknown>> {
  const { assignments, params } = toParamAssignments(values);
  const ast = createInsertAstBuilder(createTableRef(tableName)).values(assignments).build();
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileUpsertReturning(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  createValues: Record<string, unknown>,
  updateValues: Record<string, unknown>,
  conflictColumns: readonly string[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const createAssignments = toParamAssignments(createValues);
  const hasUpdateValues = Object.keys(updateValues).length > 0;
  const updateAssignments = hasUpdateValues
    ? toParamAssignments(updateValues, createAssignments.params.length + 1)
    : undefined;
  const onConflictBuilder = createInsertOnConflictAstBuilder(
    conflictColumns.map((column) => createColumnRef(tableName, column)),
  );
  if (updateAssignments) {
    onConflictBuilder.doUpdateSet(updateAssignments.assignments);
  } else {
    onConflictBuilder.doNothing();
  }
  const onConflict = onConflictBuilder.build();

  const ast = createInsertAstBuilder(createTableRef(tableName))
    .values(createAssignments.assignments)
    .onConflict(onConflict)
    .returning(buildReturningColumns(contract, tableName, returningColumns))
    .build();

  return buildOrmQueryPlan(
    contract,
    ast,
    updateAssignments ? [...createAssignments.params, ...updateAssignments.params] : createAssignments.params,
  );
}

export function compileUpdateReturning(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly WhereExpr[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const whereExpr = combineWhereFilters(filters);
  const { assignments, params } = toParamAssignments(setValues);
  const builder = createUpdateAstBuilder(createTableRef(tableName))
    .set(assignments)
    .returning(buildReturningColumns(contract, tableName, returningColumns));
  if (whereExpr) {
    builder.where(whereExpr);
  }
  const ast = builder.build();
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileUpdateCount(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly WhereExpr[],
): SqlQueryPlan<Record<string, unknown>> {
  const whereExpr = combineWhereFilters(filters);
  const { assignments, params } = toParamAssignments(setValues);
  const builder = createUpdateAstBuilder(createTableRef(tableName)).set(assignments);
  if (whereExpr) {
    builder.where(whereExpr);
  }
  const ast = builder.build();
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileDeleteReturning(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  filters: readonly WhereExpr[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const whereExpr = combineWhereFilters(filters);
  const builder = createDeleteAstBuilder(createTableRef(tableName)).returning(
    buildReturningColumns(contract, tableName, returningColumns),
  );
  if (whereExpr) {
    builder.where(whereExpr);
  }
  const ast = builder.build();
  return buildOrmQueryPlan(contract, ast, []);
}

export function compileDeleteCount(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  filters: readonly WhereExpr[],
): SqlQueryPlan<Record<string, unknown>> {
  const whereExpr = combineWhereFilters(filters);
  const builder = createDeleteAstBuilder(createTableRef(tableName));
  if (whereExpr) {
    builder.where(whereExpr);
  }
  const ast = builder.build();
  return buildOrmQueryPlan(contract, ast, []);
}
