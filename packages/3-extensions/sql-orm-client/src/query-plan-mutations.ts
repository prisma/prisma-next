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
  ProjectionItem,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@prisma-next/sql-relational-core/codec-descriptor-registry';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { ifDefined } from '@prisma-next/utils/defined';
import { buildOrmQueryPlan, deriveParamsFromAst, resolveTableColumns } from './query-plan-meta';
import { storageTableForContract, tableSourceForContract } from './storage-resolution';
import { combineWhereExprs } from './where-utils';

function buildReturningColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  returningColumns: readonly string[] | undefined,
): ReadonlyArray<ProjectionItem> {
  const columns =
    returningColumns && returningColumns.length > 0
      ? [...returningColumns]
      : resolveTableColumns(contract, namespaceId, tableName);

  return columns.map((column) =>
    ProjectionItem.of(
      column,
      ColumnRef.of(tableName, column),
      codecRefForStorageColumn(contract.storage, namespaceId, tableName, column),
    ),
  );
}

function toParamAssignments(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  values: Record<string, unknown>,
): {
  readonly assignments: Record<string, ParamRef>;
} {
  const assignments: Record<string, ParamRef> = {};

  const table = storageTableForContract(contract, namespaceId, tableName);

  for (const [column, value] of Object.entries(values)) {
    if (!table.columns[column]) {
      throw new Error(`Unknown column "${column}" in table "${tableName}"`);
    }
    const codec = codecRefForStorageColumn(contract.storage, namespaceId, tableName, column);
    assignments[column] = ParamRef.of(value, {
      name: column,
      ...ifDefined('codec', codec),
    });
  }

  return { assignments };
}

function normalizeInsertRows(
  contract: Contract<SqlStorage>,
  namespaceId: string,
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

  const table = storageTableForContract(contract, namespaceId, tableName);

  const normalizedRows = rows.map((row) => {
    if (orderedColumns.length === 0) {
      return {};
    }

    const normalizedRow: Record<string, ParamRef | DefaultValueExpr> = {};
    for (const column of orderedColumns) {
      if (Object.hasOwn(row, column)) {
        if (!table.columns[column]) {
          throw new Error(`Unknown column "${column}" in table "${tableName}"`);
        }
        const codec = codecRefForStorageColumn(contract.storage, namespaceId, tableName, column);
        normalizedRow[column] = ParamRef.of(row[column], {
          name: column,
          ...ifDefined('codec', codec),
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
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  rows: readonly Record<string, unknown>[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const { rows: normalizedRows } = normalizeInsertRows(contract, namespaceId, tableName, rows);
  const ast = InsertAst.into(tableSourceForContract(contract, namespaceId, tableName))
    .withRows(normalizedRows)
    .withReturning(buildReturningColumns(contract, namespaceId, tableName, returningColumns));
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileInsertCount(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  rows: readonly Record<string, unknown>[],
): SqlQueryPlan<Record<string, unknown>> {
  const { rows: normalizedRows } = normalizeInsertRows(contract, namespaceId, tableName, rows);
  const ast = InsertAst.into(tableSourceForContract(contract, namespaceId, tableName)).withRows(
    normalizedRows,
  );
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

function stripUndefinedValues(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

// Groups rows by their set of present columns so each group can be emitted as a single INSERT statement. Groups are created in input order — rows with the same signature that are non-adjacent produce separate groups. This is deliberate: preserving insertion order ensures autogenerated/autoincrement columns are assigned in the same order as the caller's input.
function groupRowsByColumnSignature(
  rows: readonly Record<string, unknown>[],
): ReadonlyArray<readonly Record<string, unknown>[]> {
  const groups: Array<Record<string, unknown>[]> = [];
  let currentKey = '';
  let currentGroup: Record<string, unknown>[] = [];

  for (const rawRow of rows) {
    const row = stripUndefinedValues(rawRow);
    const key = Object.keys(row).sort().join(',');
    if (key !== currentKey || currentGroup.length === 0) {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      currentKey = key;
      currentGroup = [row];
    } else {
      currentGroup.push(row);
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

export function compileInsertReturningSplit(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  rows: readonly Record<string, unknown>[],
  returningColumns: readonly string[] | undefined,
): ReadonlyArray<SqlQueryPlan<Record<string, unknown>>> {
  if (rows.length === 0) {
    throw new Error('create() requires at least one row');
  }
  return groupRowsByColumnSignature(rows).map((group) =>
    compileInsertReturning(contract, namespaceId, tableName, group, returningColumns),
  );
}

export function compileInsertCountSplit(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  rows: readonly Record<string, unknown>[],
): ReadonlyArray<SqlQueryPlan<Record<string, unknown>>> {
  if (rows.length === 0) {
    throw new Error('createCount() requires at least one row');
  }
  return groupRowsByColumnSignature(rows).map((group) =>
    compileInsertCount(contract, namespaceId, tableName, group),
  );
}

export function compileUpsertReturning(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  createValues: Record<string, unknown>,
  updateValues: Record<string, unknown>,
  conflictColumns: readonly string[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const createAssignments = toParamAssignments(contract, namespaceId, tableName, createValues);
  const hasUpdateValues = Object.keys(updateValues).length > 0;
  const updateAssignments = hasUpdateValues
    ? toParamAssignments(contract, namespaceId, tableName, updateValues)
    : undefined;
  const onConflict = updateAssignments
    ? InsertOnConflict.on(
        conflictColumns.map((column) => ColumnRef.of(tableName, column)),
      ).doUpdateSet(updateAssignments.assignments)
    : InsertOnConflict.on(
        conflictColumns.map((column) => ColumnRef.of(tableName, column)),
      ).doNothing();

  const ast = InsertAst.into(tableSourceForContract(contract, namespaceId, tableName))
    .withRows([createAssignments.assignments])
    .withOnConflict(onConflict)
    .withReturning(buildReturningColumns(contract, namespaceId, tableName, returningColumns));

  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileUpdateReturning(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly AnyExpression[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereExprs(filters);
  const { assignments } = toParamAssignments(contract, namespaceId, tableName, setValues);
  let ast = UpdateAst.table(tableSourceForContract(contract, namespaceId, tableName))
    .withSet(assignments)
    .withReturning(buildReturningColumns(contract, namespaceId, tableName, returningColumns));
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileUpdateCount(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly AnyExpression[],
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereExprs(filters);
  const { assignments } = toParamAssignments(contract, namespaceId, tableName, setValues);
  let ast = UpdateAst.table(tableSourceForContract(contract, namespaceId, tableName)).withSet(
    assignments,
  );
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileDeleteReturning(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  filters: readonly AnyExpression[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereExprs(filters);
  let ast = DeleteAst.from(tableSourceForContract(contract, namespaceId, tableName)).withReturning(
    buildReturningColumns(contract, namespaceId, tableName, returningColumns),
  );
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileDeleteCount(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  filters: readonly AnyExpression[],
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereExprs(filters);
  let ast = DeleteAst.from(tableSourceForContract(contract, namespaceId, tableName));
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}
