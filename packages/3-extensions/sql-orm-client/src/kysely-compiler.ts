import type { WhereExpr } from '@prisma-next/sql-relational-core/ast';
import type { CompiledQuery, ExpressionBuilder } from 'kysely';
import { applyCursorPagination } from './kysely-compiler-cursor';
import { type AnyDB, type AnySelectQueryBuilder, queryCompiler } from './kysely-compiler-shared';
import { combineWhereFilters, whereExprToKysely } from './kysely-compiler-where';
import type { CollectionState, IncludeExpr } from './types';

export function compileSelect(tableName: string, state: CollectionState): CompiledQuery {
  let qb = queryCompiler.selectFrom(tableName);
  qb = applyDistinct(qb, tableName, state.distinct, state.distinctOn);
  qb = applyProjection(qb, tableName, state.selectedFields);
  qb = applyWhereFilters(qb, state.filters);
  qb = applyCursorPagination(qb, tableName, state.orderBy, state.cursor);

  if (state.orderBy) {
    for (const o of state.orderBy) {
      qb = qb.orderBy(o.column, o.direction);
    }
  }

  if (state.limit !== undefined) {
    qb = qb.limit(state.limit);
  }

  if (state.offset !== undefined) {
    qb = qb.offset(state.offset);
  }

  return qb.compile();
}

export function compileRelationSelect(
  relatedTableName: string,
  fkColumn: string,
  parentPks: readonly unknown[],
  nestedState: CollectionState,
): CompiledQuery {
  let qb = queryCompiler.selectFrom(relatedTableName).where(fkColumn, 'in', [...parentPks]);
  qb = applyDistinct(qb, relatedTableName, nestedState.distinct, nestedState.distinctOn);
  qb = applyProjection(qb, relatedTableName, nestedState.selectedFields);
  qb = applyWhereFilters(qb, nestedState.filters);
  qb = applyCursorPagination(qb, relatedTableName, nestedState.orderBy, nestedState.cursor);

  if (nestedState.orderBy) {
    for (const o of nestedState.orderBy) {
      qb = qb.orderBy(o.column, o.direction);
    }
  }

  return qb.compile();
}

export function compileSelectWithIncludeStrategy(
  tableName: string,
  state: CollectionState,
  strategy: 'lateral' | 'correlated',
): CompiledQuery<Record<string, unknown>> {
  const parentAlias = '__orm_parent';
  const parentCompiled = compileSelect(tableName, {
    ...state,
    includes: [],
  });

  const sqlParameters = [...parentCompiled.parameters];
  const projectionItems = [`${quoteIdentifier(parentAlias)}.*`];
  const lateralJoins: string[] = [];

  for (const [includeIndex, include] of state.includes.entries()) {
    const includeSubquery = buildIncludeAggregateSubquery(
      include,
      parentAlias,
      includeIndex,
      sqlParameters.length,
    );
    sqlParameters.push(...includeSubquery.parameters);

    if (strategy === 'lateral') {
      const includeTableAlias = `__orm_include_${includeIndex}`;
      lateralJoins.push(
        `left join lateral (${includeSubquery.sql}) as ${quoteIdentifier(includeTableAlias)} on true`,
      );
      projectionItems.push(
        `${quoteIdentifier(includeTableAlias)}.${quoteIdentifier(include.relationName)} as ${quoteIdentifier(include.relationName)}`,
      );
      continue;
    }

    projectionItems.push(`(${includeSubquery.sql}) as ${quoteIdentifier(include.relationName)}`);
  }

  const fromClause = `from (${parentCompiled.sql}) as ${quoteIdentifier(parentAlias)}`;
  const joinsClause = lateralJoins.length > 0 ? ` ${lateralJoins.join(' ')}` : '';
  return toRawCompiledQuery<Record<string, unknown>>(
    `select ${projectionItems.join(', ')} ${fromClause}${joinsClause}`,
    sqlParameters,
  );
}

export function compileInsertReturning(
  tableName: string,
  values: readonly Record<string, unknown>[],
  returningColumns: readonly string[] | undefined,
): CompiledQuery {
  const qb = queryCompiler.insertInto(tableName).values(values);

  if (returningColumns && returningColumns.length > 0) {
    return qb.returning(returningColumns).compile();
  }

  return qb.returningAll().compile();
}

export function compileInsertCount(
  tableName: string,
  values: readonly Record<string, unknown>[],
): CompiledQuery {
  return queryCompiler.insertInto(tableName).values(values).compile();
}

export function compileUpsertReturning(
  tableName: string,
  createValues: Record<string, unknown>,
  updateValues: Record<string, unknown>,
  conflictColumns: readonly string[],
  returningColumns: readonly string[] | undefined,
): CompiledQuery {
  const base = queryCompiler
    .insertInto(tableName)
    .values(createValues)
    .onConflict((conflict) => conflict.columns(conflictColumns).doUpdateSet(updateValues));

  if (returningColumns && returningColumns.length > 0) {
    return base.returning(returningColumns).compile();
  }

  return base.returningAll().compile();
}

export function compileUpdateReturning(
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly WhereExpr[],
  returningColumns: readonly string[] | undefined,
): CompiledQuery {
  const whereExpr = combineWhereFilters(filters);

  if (whereExpr) {
    const qb = queryCompiler
      .updateTable(tableName)
      .set(setValues)
      .where((eb) => whereExprToKysely(eb as ExpressionBuilder<AnyDB, string>, whereExpr));

    if (returningColumns && returningColumns.length > 0) {
      return qb.returning(returningColumns).compile();
    }

    return qb.returningAll().compile();
  }

  const qb = queryCompiler.updateTable(tableName).set(setValues);

  if (returningColumns && returningColumns.length > 0) {
    return qb.returning(returningColumns).compile();
  }

  return qb.returningAll().compile();
}

export function compileUpdateCount(
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly WhereExpr[],
): CompiledQuery {
  const whereExpr = combineWhereFilters(filters);
  if (whereExpr) {
    return queryCompiler
      .updateTable(tableName)
      .set(setValues)
      .where((eb) => whereExprToKysely(eb as ExpressionBuilder<AnyDB, string>, whereExpr))
      .compile();
  }

  return queryCompiler.updateTable(tableName).set(setValues).compile();
}

export function compileDeleteReturning(
  tableName: string,
  filters: readonly WhereExpr[],
  returningColumns: readonly string[] | undefined,
): CompiledQuery {
  const whereExpr = combineWhereFilters(filters);

  if (whereExpr) {
    const qb = queryCompiler
      .deleteFrom(tableName)
      .where((eb) => whereExprToKysely(eb as ExpressionBuilder<AnyDB, string>, whereExpr));

    if (returningColumns && returningColumns.length > 0) {
      return qb.returning(returningColumns).compile();
    }

    return qb.returningAll().compile();
  }

  const qb = queryCompiler.deleteFrom(tableName);

  if (returningColumns && returningColumns.length > 0) {
    return qb.returning(returningColumns).compile();
  }

  return qb.returningAll().compile();
}

export function compileDeleteCount(
  tableName: string,
  filters: readonly WhereExpr[],
): CompiledQuery {
  const whereExpr = combineWhereFilters(filters);
  if (whereExpr) {
    return queryCompiler
      .deleteFrom(tableName)
      .where((eb) => whereExprToKysely(eb as ExpressionBuilder<AnyDB, string>, whereExpr))
      .compile();
  }

  return queryCompiler.deleteFrom(tableName).compile();
}

function applyWhereFilters<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  filters: readonly WhereExpr[],
): QueryBuilder {
  const whereExpr = combineWhereFilters(filters);
  if (!whereExpr) {
    return qb;
  }

  return qb.where((eb) =>
    whereExprToKysely(eb as ExpressionBuilder<AnyDB, string>, whereExpr),
  ) as QueryBuilder;
}

function applyProjection<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  tableName: string,
  selectedFields: readonly string[] | undefined,
): QueryBuilder {
  if (!selectedFields || selectedFields.length === 0) {
    return qb.selectAll() as QueryBuilder;
  }

  const qualified = selectedFields.map((column) => `${tableName}.${column}`);
  return qb.select(qualified) as QueryBuilder;
}

function applyDistinct<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  tableName: string,
  distinct: readonly string[] | undefined,
  distinctOn: readonly string[] | undefined,
): QueryBuilder {
  if (distinctOn && distinctOn.length > 0) {
    const qualified = distinctOn.map((column) => `${tableName}.${column}`);
    return qb.distinctOn(qualified) as QueryBuilder;
  }

  if (distinct && distinct.length > 0) {
    return qb.distinct() as QueryBuilder;
  }

  return qb;
}

function buildIncludeAggregateSubquery(
  include: IncludeExpr,
  parentAlias: string,
  includeIndex: number,
  parameterOffset: number,
): {
  sql: string;
  parameters: readonly unknown[];
} {
  const joinFilter: WhereExpr = {
    kind: 'bin',
    op: 'eq',
    left: {
      kind: 'col',
      table: include.relatedTableName,
      column: include.fkColumn,
    },
    right: {
      kind: 'col',
      table: parentAlias,
      column: include.parentPkColumn,
    },
  };

  const childCompiled = compileSelect(include.relatedTableName, {
    ...include.nested,
    includes: [],
    filters: [joinFilter, ...include.nested.filters],
  });

  const childAlias = `__orm_child_${includeIndex}`;
  const shiftedChildSql = shiftParameterPlaceholders(childCompiled.sql, parameterOffset);
  const aggregateSql =
    `select coalesce(json_agg(row_to_json(${quoteIdentifier(childAlias)}.*)), '[]'::json) ` +
    `as ${quoteIdentifier(include.relationName)} from (${shiftedChildSql}) ` +
    `as ${quoteIdentifier(childAlias)}`;

  return {
    sql: aggregateSql,
    parameters: childCompiled.parameters,
  };
}

function shiftParameterPlaceholders(sqlText: string, parameterOffset: number): string {
  if (parameterOffset === 0) {
    return sqlText;
  }

  return sqlText.replace(/\$(\d+)/g, (_full, group) => {
    const index = Number(group);
    return `$${index + parameterOffset}`;
  });
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function toRawCompiledQuery<Row>(
  sqlText: string,
  parameters: readonly unknown[],
): CompiledQuery<Row> {
  return {
    sql: sqlText,
    parameters: [...parameters],
  } as unknown as CompiledQuery<Row>;
}
