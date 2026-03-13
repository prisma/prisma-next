import type { ParamDescriptor } from '@prisma-next/contract/types';
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
import { buildOrmQueryPlan, resolveTableColumns } from './query-plan-meta';
import { combineWhereFilters, offsetBoundWhereExpr } from './where-utils';

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

function createColumnParamDescriptor(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  columnName: string,
  index: number,
): ParamDescriptor {
  const columnMeta = contract.storage.tables[tableName]?.columns[columnName];
  return {
    index,
    name: columnName,
    source: 'dsl',
    ...(columnMeta
      ? {
          codecId: columnMeta.codecId,
          nativeType: columnMeta.nativeType,
          nullable: columnMeta.nullable,
          refs: { table: tableName, column: columnName },
        }
      : {}),
  };
}

function toParamAssignments(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  values: Record<string, unknown>,
  startIndex = 1,
): {
  readonly assignments: Record<string, ParamRef>;
  readonly params: readonly unknown[];
  readonly paramDescriptors: readonly ParamDescriptor[];
} {
  const assignments: Record<string, ParamRef> = {};
  const params: unknown[] = [];
  const paramDescriptors: ParamDescriptor[] = [];
  let index = startIndex;

  for (const [column, value] of Object.entries(values)) {
    assignments[column] = ParamRef.of(index, column);
    params.push(value);
    paramDescriptors.push(createColumnParamDescriptor(contract, tableName, column, index));
    index += 1;
  }

  return {
    assignments,
    params,
    paramDescriptors,
  };
}

function normalizeInsertRows(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  rows: readonly Record<string, unknown>[],
): {
  readonly rows: ReadonlyArray<Record<string, ParamRef | DefaultValueExpr>>;
  readonly params: readonly unknown[];
  readonly paramDescriptors: readonly ParamDescriptor[];
} {
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

  const params: unknown[] = [];
  const paramDescriptors: ParamDescriptor[] = [];
  let index = 1;
  const normalizedRows = rows.map((row) => {
    if (orderedColumns.length === 0) {
      return {};
    }

    const normalizedRow: Record<string, ParamRef | DefaultValueExpr> = {};
    for (const column of orderedColumns) {
      if (Object.hasOwn(row, column)) {
        normalizedRow[column] = ParamRef.of(index, column);
        params.push(row[column]);
        paramDescriptors.push(createColumnParamDescriptor(contract, tableName, column, index));
        index += 1;
        continue;
      }
      normalizedRow[column] = new DefaultValueExpr();
    }
    return normalizedRow;
  });

  return {
    rows: normalizedRows,
    params,
    paramDescriptors,
  };
}

export function compileInsertReturning(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  rows: readonly Record<string, unknown>[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const {
    rows: normalizedRows,
    params,
    paramDescriptors,
  } = normalizeInsertRows(contract, tableName, rows);
  const ast = InsertAst.into(TableSource.named(tableName))
    .withRows(normalizedRows)
    .withReturning(buildReturningColumns(contract, tableName, returningColumns));
  return buildOrmQueryPlan(contract, ast, params, paramDescriptors);
}

export function compileInsertCount(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  rows: readonly Record<string, unknown>[],
): SqlQueryPlan<Record<string, unknown>> {
  const {
    rows: normalizedRows,
    params,
    paramDescriptors,
  } = normalizeInsertRows(contract, tableName, rows);
  const ast = InsertAst.into(TableSource.named(tableName)).withRows(normalizedRows);
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
    ? toParamAssignments(contract, tableName, updateValues, createAssignments.params.length + 1)
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

  return buildOrmQueryPlan(
    contract,
    ast,
    updateAssignments
      ? [...createAssignments.params, ...updateAssignments.params]
      : createAssignments.params,
    updateAssignments
      ? [...createAssignments.paramDescriptors, ...updateAssignments.paramDescriptors]
      : createAssignments.paramDescriptors,
  );
}

export function compileUpdateReturning(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly BoundWhereExpr[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereFilters(filters);
  const { assignments, params, paramDescriptors } = toParamAssignments(
    contract,
    tableName,
    setValues,
  );
  let ast = UpdateAst.table(TableSource.named(tableName))
    .withSet(assignments)
    .withReturning(buildReturningColumns(contract, tableName, returningColumns));
  const shiftedWhere = where ? offsetBoundWhereExpr(where, params.length) : undefined;
  if (shiftedWhere) {
    ast = ast.withWhere(shiftedWhere.expr);
  }
  return buildOrmQueryPlan(
    contract,
    ast,
    shiftedWhere ? [...params, ...shiftedWhere.params] : params,
    shiftedWhere ? [...paramDescriptors, ...shiftedWhere.paramDescriptors] : paramDescriptors,
  );
}

export function compileUpdateCount(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly BoundWhereExpr[],
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereFilters(filters);
  const { assignments, params, paramDescriptors } = toParamAssignments(
    contract,
    tableName,
    setValues,
  );
  let ast = UpdateAst.table(TableSource.named(tableName)).withSet(assignments);
  const shiftedWhere = where ? offsetBoundWhereExpr(where, params.length) : undefined;
  if (shiftedWhere) {
    ast = ast.withWhere(shiftedWhere.expr);
  }
  return buildOrmQueryPlan(
    contract,
    ast,
    shiftedWhere ? [...params, ...shiftedWhere.params] : params,
    shiftedWhere ? [...paramDescriptors, ...shiftedWhere.paramDescriptors] : paramDescriptors,
  );
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
  return buildOrmQueryPlan(contract, ast, where?.params ?? [], where?.paramDescriptors ?? []);
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
  return buildOrmQueryPlan(contract, ast, where?.params ?? [], where?.paramDescriptors ?? []);
}
