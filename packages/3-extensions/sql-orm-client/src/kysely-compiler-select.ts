import type { WhereExpr } from '@prisma-next/sql-relational-core/ast';
import type { CompiledQuery } from 'kysely';
import { applyCursorPagination } from './kysely-compiler-cursor';
import { applyDistinct, applyProjection, applyWhereFilters } from './kysely-compiler-query-state';
import {
  quoteIdentifier,
  shiftParameterPlaceholders,
  toRawCompiledQuery,
} from './kysely-compiler-raw';
import { queryCompiler } from './kysely-compiler-shared';
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
