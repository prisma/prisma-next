import type { Plan } from '@prisma-next/contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { RuntimeContext } from './sql-context';

/**
 * Lowers a SQL query plan to an executable Plan by calling the adapter's lower method.
 *
 * This function is responsible for converting a lane-produced SqlQueryPlan (which contains
 * AST and params but no SQL) into a fully executable Plan (which includes SQL string).
 *
 * @param context - Runtime context containing the adapter
 * @param queryPlan - SQL query plan from a lane (contains AST, params, meta, but no SQL)
 * @returns Fully executable Plan with SQL string
 */
export function lowerSqlPlan<Row>(
  context: RuntimeContext,
  queryPlan: SqlQueryPlan<Row>,
): Plan<Row> {
  const lowered = context.adapter.lower(queryPlan.ast, {
    contract: context.contract,
    params: queryPlan.params,
  });

  const body = lowered.body;

  return Object.freeze({
    sql: body.sql,
    params: body.params ?? queryPlan.params,
    ast: queryPlan.ast,
    meta: queryPlan.meta,
  });
}
