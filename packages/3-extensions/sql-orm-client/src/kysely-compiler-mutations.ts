import type { WhereExpr } from '@prisma-next/sql-relational-core/ast';
import type { CompiledQuery, ExpressionBuilder } from 'kysely';
import type { AnyDB } from './kysely-compiler-shared';
import { queryCompiler } from './kysely-compiler-shared';
import { combineWhereFilters, whereExprToKysely } from './kysely-compiler-where';

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
  const hasUpdateValues = Object.keys(updateValues).length > 0;
  const base = queryCompiler
    .insertInto(tableName)
    .values(createValues)
    .onConflict((conflict) => {
      const conflictBuilder = conflict.columns(conflictColumns);
      if (!hasUpdateValues) {
        return conflictBuilder.doNothing();
      }

      return conflictBuilder.doUpdateSet(updateValues);
    });

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
