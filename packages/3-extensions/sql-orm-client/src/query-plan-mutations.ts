import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { BoundWhereExpr } from '@prisma-next/sql-relational-core/ast';
import {
  createColumnRef,
  createDefaultValueExpr,
  createDeleteAstBuilder,
  createInsertAstBuilder,
  createInsertOnConflictAstBuilder,
  createParamRef,
  createTableRef,
  createUpdateAstBuilder,
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

  return columns.map((column) => createColumnRef(tableName, column));
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
  readonly assignments: Record<string, ReturnType<typeof createParamRef>>;
  readonly params: readonly unknown[];
  readonly paramDescriptors: readonly ParamDescriptor[];
} {
  const assignments: Record<string, ReturnType<typeof createParamRef>> = {};
  const params: unknown[] = [];
  const paramDescriptors: ParamDescriptor[] = [];
  let index = startIndex;

  for (const [column, value] of Object.entries(values)) {
    assignments[column] = createParamRef(index, column);
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
  readonly rows: ReadonlyArray<
    Record<string, ReturnType<typeof createParamRef> | ReturnType<typeof createDefaultValueExpr>>
  >;
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

    const normalizedRow: Record<
      string,
      ReturnType<typeof createParamRef> | ReturnType<typeof createDefaultValueExpr>
    > = {};
    for (const column of orderedColumns) {
      if (Object.hasOwn(row, column)) {
        normalizedRow[column] = createParamRef(index, column);
        params.push(row[column]);
        paramDescriptors.push(createColumnParamDescriptor(contract, tableName, column, index));
        index += 1;
        continue;
      }
      normalizedRow[column] = createDefaultValueExpr();
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
  const ast = createInsertAstBuilder(createTableRef(tableName))
    .rows(normalizedRows)
    .returning(buildReturningColumns(contract, tableName, returningColumns))
    .build();
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
  const ast = createInsertAstBuilder(createTableRef(tableName)).rows(normalizedRows).build();
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
  const builder = createUpdateAstBuilder(createTableRef(tableName))
    .set(assignments)
    .returning(buildReturningColumns(contract, tableName, returningColumns));
  const shiftedWhere = where ? offsetBoundWhereExpr(where, params.length) : undefined;
  if (shiftedWhere) {
    builder.where(shiftedWhere.expr);
  }
  const ast = builder.build();
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
  const builder = createUpdateAstBuilder(createTableRef(tableName)).set(assignments);
  const shiftedWhere = where ? offsetBoundWhereExpr(where, params.length) : undefined;
  if (shiftedWhere) {
    builder.where(shiftedWhere.expr);
  }
  const ast = builder.build();
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
  const builder = createDeleteAstBuilder(createTableRef(tableName)).returning(
    buildReturningColumns(contract, tableName, returningColumns),
  );
  if (where) {
    builder.where(where.expr);
  }
  const ast = builder.build();
  return buildOrmQueryPlan(contract, ast, where?.params ?? [], where?.paramDescriptors ?? []);
}

export function compileDeleteCount(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  filters: readonly BoundWhereExpr[],
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereFilters(filters);
  const builder = createDeleteAstBuilder(createTableRef(tableName));
  if (where) {
    builder.where(where.expr);
  }
  const ast = builder.build();
  return buildOrmQueryPlan(contract, ast, where?.params ?? [], where?.paramDescriptors ?? []);
}
