import type { BinaryExpr, WhereExpr } from '@prisma-next/sql-relational-core/ast';
import { type CompiledQuery, type ExpressionBuilder, sql } from 'kysely';
import { applyCursorPagination } from './kysely-compiler-cursor';
import { type AnyDB, type AnySelectQueryBuilder, queryCompiler } from './kysely-compiler-shared';
import { combineWhereFilters, whereExprToKysely } from './kysely-compiler-where';
import type { AggregateSelector, CollectionState, IncludeExpr } from './types';

export const GROUPED_HAVING_TABLE = '__orm_having';

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

export function compileAggregate(
  tableName: string,
  filters: readonly WhereExpr[],
  aggregateSpec: Record<string, AggregateSelector<unknown>>,
): CompiledQuery<Record<string, unknown>> {
  const entries = Object.entries(aggregateSpec);
  if (entries.length === 0) {
    throw new Error('aggregate() requires at least one aggregation selector');
  }

  let qb = queryCompiler.selectFrom(tableName);
  qb = applyWhereFilters(qb, filters);
  const selections = entries.map(([alias, selector]) =>
    buildAggregateSelection(tableName, selector, alias),
  );

  return qb.select(selections as never).compile() as CompiledQuery<Record<string, unknown>>;
}

export function compileGroupedAggregate(
  tableName: string,
  filters: readonly WhereExpr[],
  groupByColumns: readonly string[],
  aggregateSpec: Record<string, AggregateSelector<unknown>>,
  havingExpr: WhereExpr | undefined,
): CompiledQuery<Record<string, unknown>> {
  if (groupByColumns.length === 0) {
    throw new Error('groupBy() requires at least one field');
  }

  const entries = Object.entries(aggregateSpec);
  if (entries.length === 0) {
    throw new Error('groupBy().aggregate() requires at least one aggregation selector');
  }

  let qb = queryCompiler.selectFrom(tableName);
  qb = applyWhereFilters(qb, filters);
  const groupedSelects = groupByColumns.map((column) => `${tableName}.${column}`);
  const aggregateSelects = entries.map(([alias, selector]) =>
    buildAggregateSelection(tableName, selector, alias),
  );
  qb = qb.select([...groupedSelects, ...aggregateSelects] as never);

  for (const groupColumn of groupByColumns) {
    qb = qb.groupBy(`${tableName}.${groupColumn}`);
  }

  const compiled = qb.compile();
  if (!havingExpr) {
    return compiled as CompiledQuery<Record<string, unknown>>;
  }

  const havingCompiled = compileGroupedHavingExpr(
    havingExpr,
    tableName,
    compiled.parameters.length,
  );
  return toRawCompiledQuery<Record<string, unknown>>(
    `${compiled.sql} having ${havingCompiled.sql}`,
    [...compiled.parameters, ...havingCompiled.parameters],
  );
}

export function compileHavingMetricColumn(
  fn: 'sum' | 'avg' | 'min' | 'max',
  column: string,
): string {
  return `${fn}:${column}`;
}

export function compileSelectWithIncludeStrategy(
  tableName: string,
  state: CollectionState,
  strategy: 'lateral' | 'correlated',
): CompiledQuery<Record<string, unknown>> {
  if (
    state.includes.some((include) => include.scalar !== undefined || include.combine !== undefined)
  ) {
    throw new Error(
      'single-query include strategy does not support scalar include selectors or combine()',
    );
  }

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

function buildAggregateSelection(
  tableName: string,
  selector: AggregateSelector<unknown>,
  alias: string,
) {
  if (selector.fn === 'count') {
    return sql<number>`count(*)`.as(alias);
  }

  const column = selector.column;
  if (!column) {
    throw new Error(`Aggregate selector "${selector.fn}" requires a field`);
  }

  const qualifiedColumn = sql.ref(`${tableName}.${column}`);
  if (selector.fn === 'sum') {
    return sql<number | null>`sum(${qualifiedColumn})`.as(alias);
  }
  if (selector.fn === 'avg') {
    return sql<number | null>`avg(${qualifiedColumn})`.as(alias);
  }
  if (selector.fn === 'min') {
    return sql<number | null>`min(${qualifiedColumn})`.as(alias);
  }
  return sql<number | null>`max(${qualifiedColumn})`.as(alias);
}

function compileGroupedHavingExpr(
  expr: WhereExpr,
  tableName: string,
  parameterOffset: number,
): {
  sql: string;
  parameters: readonly unknown[];
} {
  const parameters: unknown[] = [];

  const pushParameter = (value: unknown): string => {
    parameters.push(value);
    return `$${parameterOffset + parameters.length}`;
  };

  const renderRight = (right: BinaryExpr['right'], op: string): string => {
    if (!right || typeof right !== 'object') {
      throw new Error(`Unsupported grouped having right operand for operator "${op}"`);
    }

    const candidate = right as { kind?: string; value?: unknown; values?: readonly unknown[] };
    if (candidate.kind === 'literal') {
      const literalValue = (candidate as { value: unknown }).value;
      if ((op === 'IN' || op === 'NOT IN') && Array.isArray(literalValue)) {
        if (literalValue.length === 0) {
          return '(NULL)';
        }
        return `(${literalValue.map((value) => pushParameter(value)).join(', ')})`;
      }
      return pushParameter(literalValue);
    }

    if (candidate.kind === 'param') {
      throw new Error('ParamRef is not supported in grouped having expressions');
    }

    if (candidate.kind === 'listLiteral') {
      const values = (candidate as { values: readonly { value?: unknown }[] }).values;
      if (values.length === 0) {
        return '(NULL)';
      }
      const rendered = values.map((value) => {
        if (value && typeof value === 'object' && 'value' in value) {
          return pushParameter(value.value);
        }
        return pushParameter(value);
      });
      return `(${rendered.join(', ')})`;
    }

    if (candidate.kind === 'col') {
      const col = candidate as { table: string; column: string };
      if (col.table !== GROUPED_HAVING_TABLE) {
        return `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`;
      }
      return renderHavingMetric(col.column, tableName);
    }

    throw new Error(
      `Unsupported grouped having right operand kind "${candidate.kind ?? 'unknown'}"`,
    );
  };

  const renderExpr = (node: WhereExpr): string => {
    if (node.kind === 'and') {
      if (node.exprs.length === 0) {
        return 'TRUE';
      }
      return `(${node.exprs.map((child) => renderExpr(child)).join(' AND ')})`;
    }

    if (node.kind === 'or') {
      if (node.exprs.length === 0) {
        return 'FALSE';
      }
      return `(${node.exprs.map((child) => renderExpr(child)).join(' OR ')})`;
    }

    if (node.kind === 'nullCheck') {
      if (node.expr.kind !== 'col' || node.expr.table !== GROUPED_HAVING_TABLE) {
        throw new Error('groupBy().having() only supports aggregate metric expressions');
      }
      const metric = renderHavingMetric(node.expr.column, tableName);
      return `${metric} IS ${node.isNull ? '' : 'NOT '}NULL`;
    }

    if (node.kind !== 'bin') {
      throw new Error(`Unsupported grouped having expression kind "${node.kind}"`);
    }

    if (node.left.kind !== 'col' || node.left.table !== GROUPED_HAVING_TABLE) {
      throw new Error('groupBy().having() only supports aggregate metric expressions');
    }

    const operator = mapBinaryOpToSql(node.op);
    const left = renderHavingMetric(node.left.column, tableName);
    const right = renderRight(node.right, operator);
    return `${left} ${operator} ${right}`;
  };

  return {
    sql: renderExpr(expr),
    parameters,
  };
}

function renderHavingMetric(metric: string, tableName: string): string {
  if (metric === 'count') {
    return 'count(*)';
  }

  const [fn, column] = metric.split(':', 2);
  if (!column) {
    throw new Error(`Invalid grouped having metric "${metric}"`);
  }

  if (fn !== 'sum' && fn !== 'avg' && fn !== 'min' && fn !== 'max') {
    throw new Error(`Unsupported grouped having metric "${metric}"`);
  }

  return `${fn}(${quoteIdentifier(tableName)}.${quoteIdentifier(column)})`;
}

function mapBinaryOpToSql(op: string): string {
  switch (op) {
    case 'eq':
      return '=';
    case 'neq':
      return '!=';
    case 'gt':
      return '>';
    case 'lt':
      return '<';
    case 'gte':
      return '>=';
    case 'lte':
      return '<=';
    case 'like':
      return 'LIKE';
    case 'ilike':
      return 'ILIKE';
    case 'in':
      return 'IN';
    case 'notIn':
      return 'NOT IN';
    default:
      throw new Error(`Unsupported grouped having operator "${op}"`);
  }
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
