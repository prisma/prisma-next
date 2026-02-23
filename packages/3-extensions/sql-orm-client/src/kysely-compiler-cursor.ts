import { type SqlBool, sql } from 'kysely';
import type { AnySelectQueryBuilder } from './kysely-compiler-shared';
import type { OrderExpr } from './types';

type CursorOrderEntry = OrderExpr & {
  readonly value: unknown;
};

export function applyCursorPagination<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  tableName: string,
  orderBy: readonly OrderExpr[] | undefined,
  cursor: Readonly<Record<string, unknown>> | undefined,
): QueryBuilder {
  if (!cursor || !orderBy || orderBy.length === 0) {
    return qb;
  }

  const entries: CursorOrderEntry[] = [];
  for (const order of orderBy) {
    const value = cursor[order.column];
    if (value === undefined) {
      throw new Error(`Missing cursor value for orderBy column "${order.column}"`);
    }
    entries.push({
      ...order,
      value,
    });
  }

  const firstEntry = entries[0];
  if (entries.length === 1 && firstEntry !== undefined) {
    return applySingleCursorPagination(qb, tableName, firstEntry);
  }

  const firstDirection = entries[0]?.direction;
  const isUniformDirection =
    firstDirection !== undefined && entries.every((entry) => entry.direction === firstDirection);

  if (isUniformDirection) {
    return applyTupleCursorPagination(qb, tableName, entries, firstDirection === 'asc' ? '>' : '<');
  }

  return applyLexicographicCursorPagination(qb, tableName, entries);
}

function applySingleCursorPagination<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  tableName: string,
  cursor: CursorOrderEntry,
): QueryBuilder {
  const comparator = cursor.direction === 'asc' ? '>' : '<';
  const columnRef = sql.ref(`${tableName}.${cursor.column}`);
  const cursorValue = sql`${cursor.value}`;
  return qb.where(sql<SqlBool>`${columnRef} ${sql.raw(comparator)} ${cursorValue}`) as QueryBuilder;
}

function applyTupleCursorPagination<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  tableName: string,
  entries: readonly CursorOrderEntry[],
  comparator: '>' | '<',
): QueryBuilder {
  const tupleColumns = sql.join(entries.map((entry) => sql.ref(`${tableName}.${entry.column}`)));
  const tupleValues = sql.join(entries.map((entry) => sql`${entry.value}`));
  return qb.where(
    sql<SqlBool>`(${tupleColumns}) ${sql.raw(comparator)} (${tupleValues})`,
  ) as QueryBuilder;
}

function applyLexicographicCursorPagination<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  tableName: string,
  entries: readonly CursorOrderEntry[],
): QueryBuilder {
  const branches = entries.map((entry, index) => {
    const equalities = entries.slice(0, index).map((prefixEntry) => {
      const columnRef = sql.ref(`${tableName}.${prefixEntry.column}`);
      return sql<SqlBool>`${columnRef} = ${sql`${prefixEntry.value}`}`;
    });

    const comparator = entry.direction === 'asc' ? '>' : '<';
    const boundary = sql<SqlBool>`${sql.ref(`${tableName}.${entry.column}`)} ${sql.raw(comparator)} ${sql`${entry.value}`}`;

    if (equalities.length === 0) {
      return boundary;
    }

    return sql<SqlBool>`(${sql.join([...equalities, boundary], sql` and `)})`;
  });

  return qb.where(sql<SqlBool>`${sql.join(branches, sql` or `)}`) as QueryBuilder;
}
