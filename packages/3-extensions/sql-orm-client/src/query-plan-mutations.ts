import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  type BoundWhereExpr,
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
import { combineWhereFilters } from './where-utils';

function buildReturningColumns(
  contract: SqlContract<SqlStorage>,
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
  contract: SqlContract<SqlStorage>,
  tableName: string,
  values: Record<string, unknown>,
): {
  readonly assignments: Record<string, ParamRef>;
} {
  const assignments: Record<string, ParamRef> = {};

  for (const [column, value] of Object.entries(values)) {
    const columnMeta = contract.storage.tables[tableName]?.columns[column];
    assignments[column] = ParamRef.of(value, {
      name: column,
      ...(columnMeta?.codecId !== undefined && { codecId: columnMeta.codecId }),
    });
  }

  return { assignments };
}

function normalizeInsertRows(
  contract: SqlContract<SqlStorage>,
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
        const columnMeta = contract.storage.tables[tableName]?.columns[column];
        normalizedRow[column] = ParamRef.of(row[column], {
          name: column,
          ...(columnMeta?.codecId !== undefined && { codecId: columnMeta.codecId }),
        });
        continue;
      }
      normalizedRow[column] = new DefaultValueExpr();
    }
    return normalizedRow;
  });

  return { rows: normalizedRows };
}

export function compileInsertReturning(
  contract: SqlContract<SqlStorage>,
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
  contract: SqlContract<SqlStorage>,
  tableName: string,
  rows: readonly Record<string, unknown>[],
): SqlQueryPlan<Record<string, unknown>> {
  const { rows: normalizedRows } = normalizeInsertRows(contract, tableName, rows);
  const ast = InsertAst.into(TableSource.named(tableName)).withRows(normalizedRows);
  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}

export function compileUpsertReturning(
  contract: SqlContract<SqlStorage>,
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
  contract: SqlContract<SqlStorage>,
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly BoundWhereExpr[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereFilters(filters);
  const { assignments } = toParamAssignments(contract, tableName, setValues);
  let ast = UpdateAst.table(TableSource.named(tableName))
    .withSet(assignments)
    .withReturning(buildReturningColumns(contract, tableName, returningColumns));
  if (where) {
    ast = ast.withWhere(where.expr);
  }
  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}

export function compileUpdateCount(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly BoundWhereExpr[],
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereFilters(filters);
  const { assignments } = toParamAssignments(contract, tableName, setValues);
  let ast = UpdateAst.table(TableSource.named(tableName)).withSet(assignments);
  if (where) {
    ast = ast.withWhere(where.expr);
  }
  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}

export function compileDeleteReturning(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  filters: readonly BoundWhereExpr[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereFilters(filters);
  let ast = DeleteAst.from(TableSource.named(tableName)).withReturning(
    buildReturningColumns(contract, tableName, returningColumns),
  );
  if (where) {
    ast = ast.withWhere(where.expr);
  }
  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}

export function compileDeleteCount(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  filters: readonly BoundWhereExpr[],
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereFilters(filters);
  let ast = DeleteAst.from(TableSource.named(tableName));
  if (where) {
    ast = ast.withWhere(where.expr);
  }
  const { params, paramDescriptors } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}
