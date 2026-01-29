import type { Runtime } from '@prisma-next/sql-runtime';
import { sql, tables } from '../prisma/query';
import { collect } from './utils';

/**
 * WARNING: This query intentionally violates the row budget to demonstrate
 * budget enforcement. It selects all posts without a LIMIT clause, which
 * will trigger a BUDGET.ROWS_EXCEEDED error when the estimated row count
 * exceeds the budget (default: 10,000 rows).
 *
 * This demonstrates the budget workflow:
 * 1. Budget plugin checks the query before execution
 * 2. Detects unbounded SELECT (no LIMIT)
 * 3. Throws BUDGET.ROWS_EXCEEDED error
 * 4. Query execution is blocked
 *
 * To fix this query, add a .limit() clause or add proper filtering.
 */
export async function getAllPostsUnbounded(runtime: Runtime) {
  const postTable = tables.post;

  // This query has no LIMIT, so it will violate the budget
  const plan = sql
    .from(postTable)
    .select({
      id: postTable.columns.id,
      title: postTable.columns.title,
      userId: postTable.columns.userId,
      createdAt: postTable.columns.createdAt,
    })
    // Intentionally missing .limit() to trigger budget violation
    .build();

  return collect(runtime.execute(plan));
}
