import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { Adapter, AnyQueryAst, LoweredStatement } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';

/**
 * Lowers a SQL query plan to an executable Plan by calling the adapter's lower method.
 *
 * @param adapter - Adapter to lower AST to SQL
 * @param contract - Contract for lowering context
 * @param queryPlan - SQL query plan from a lane (contains AST, params, meta, but no SQL)
 * @returns Fully executable Plan with SQL string
 */
export function lowerSqlPlan<Row>(
  adapter: Adapter<AnyQueryAst, SqlContract<SqlStorage>, LoweredStatement>,
  contract: SqlContract<SqlStorage>,
  queryPlan: SqlQueryPlan<Row>,
): ExecutionPlan<Row> {
  const lowered = adapter.lower(queryPlan.ast, {
    contract,
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
