import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  type AnyExpression,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  InsertAst,
  InsertOnConflict,
  ParamRef,
  TableSource,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { buildOrmQueryPlan, deriveParamsFromAst, resolveTableColumns } from './query-plan-meta';
import { combineWhereExprs } from './where-utils';

function buildReturningColumns(
  contract: Contract<SqlStorage>,
  tableName: string,
  returningColumns: readonly string[] | undefined,
) {
  const columns =
    returningColumns && returningColumns.length > 0
      ? [...returningColumns]
      : resolveTableColumns(contract, tableName);

  return columns.map((column) => ColumnRef.of(tableName, column));
}

function toParamAssignments(
  contract: Contract<SqlStorage>,
  tableName: string,
  values: Record<string, unknown>,
): {
  readonly assignments: Record<string, ParamRef>;
} {
  const assignments: Record<string, ParamRef> = {};

  const table = contract.storage.tables[tableName];
  if (!table) {
    throw new Error(`Unknown table "${tableName}"`);
  }

  for (const [column, value] of Object.entries(values)) {
    const codecId = table.columns[column]?.codecId;
    if (!codecId) {
      throw new Error(`Unknown column "${column}" in table "${tableName}"`);
    }
    assignments[column] = ParamRef.of(value, { name: column, codecId });
  }

  return { assignments };
}

function normalizeInsertRows(
  contract: Contract<SqlStorage>,
  tableName: string,
  rows: readonly Record<string, unknown>[],
): {
  readonly rows: ReadonlyArray<Record<string, ParamRef | DefaultValueExpr>>;
} {
  if (rows.length === 0) {
    throw new Error('normalizeInsertRows requires at least one row');
  }

  const orderedColumns: string[] = [];
  const seenColumns = new Set<string>();

  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (seenColumns.has(column)) {
        continue;
      }
      seenColumns.add(column);
      orderedColumns.push(column);
    }
  }

  const normalizedRows = rows.map((row) => {
    if (orderedColumns.length === 0) {
      return {};
    }

    const normalizedRow: Record<string, ParamRef | DefaultValueExpr> = {};
    for (const column of orderedColumns) {
      if (Object.hasOwn(row, column)) {
        const table = contract.storage.tables[tableName];
        if (!table) {
          throw new Error(`Unknown table "${tableName}"`);
        }
        const codecId = table?.columns[column]?.codecId;
        if (!codecId) {
          throw new Error(`Unknown column "${column}" in table "${tableName}"`);
        }
        normalizedRow[column] = ParamRef.of(row[column], { name: column, codecId });
        continue;
      }
      normalizedRow[column] = new DefaultValueExpr();
    }
    return normalizedRow;
  });

  return { rows: normalizedRows };
}

export function compileInsertReturning(
  contract: Contract<SqlStorage>,
  tableName: string,
  rows: readonly Record<string, unknown>[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const { rows: normalizedRows } = normalizeInsertRows(contract, tableName, rows);
  const ast = InsertAst.into(TableSource.named(tableName))
    .withRows(normalizedRows)
    .withReturning(buildReturningColumns(contract, tableName, returningColumns));
  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}

export function compileInsertCount(
  contract: Contract<SqlStorage>,
  tableName: string,
  rows: readonly Record<string, unknown>[],
): SqlQueryPlan<Record<string, unknown>> {
  const { rows: normalizedRows } = normalizeInsertRows(contract, tableName, rows);
  const ast = InsertAst.into(TableSource.named(tableName)).withRows(normalizedRows);
  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}

export function compileUpsertReturning(
  contract: Contract<SqlStorage>,
  tableName: string,
  createValues: Record<string, unknown>,
  updateValues: Record<string, unknown>,
  conflictColumns: readonly string[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const createAssignments = toParamAssignments(contract, tableName, createValues);
  const hasUpdateValues = Object.keys(updateValues).length > 0;
  const updateAssignments = hasUpdateValues
    ? toParamAssignments(contract, tableName, updateValues)
    : undefined;
  const onConflict = updateAssignments
    ? InsertOnConflict.on(
        conflictColumns.map((column) => ColumnRef.of(tableName, column)),
      ).doUpdateSet(updateAssignments.assignments)
    : InsertOnConflict.on(
        conflictColumns.map((column) => ColumnRef.of(tableName, column)),
      ).doNothing();

  const ast = InsertAst.into(TableSource.named(tableName))
    .withValues(createAssignments.assignments)
    .withOnConflict(onConflict)
    .withReturning(buildReturningColumns(contract, tableName, returningColumns));

  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}

export function compileUpdateReturning(
  contract: Contract<SqlStorage>,
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly AnyExpression[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereExprs(filters);
  const { assignments } = toParamAssignments(contract, tableName, setValues);
  let ast = UpdateAst.table(TableSource.named(tableName))
    .withSet(assignments)
    .withReturning(buildReturningColumns(contract, tableName, returningColumns));
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}

export function compileUpdateCount(
  contract: Contract<SqlStorage>,
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly AnyExpression[],
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereExprs(filters);
  const { assignments } = toParamAssignments(contract, tableName, setValues);
  let ast = UpdateAst.table(TableSource.named(tableName)).withSet(assignments);
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}

export function compileDeleteReturning(
  contract: Contract<SqlStorage>,
  tableName: string,
  filters: readonly AnyExpression[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereExprs(filters);
  let ast = DeleteAst.from(TableSource.named(tableName)).withReturning(
    buildReturningColumns(contract, tableName, returningColumns),
  );
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}

export function compileDeleteCount(
  contract: Contract<SqlStorage>,
  tableName: string,
  filters: readonly AnyExpression[],
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereExprs(filters);
  let ast = DeleteAst.from(TableSource.named(tableName));
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}
