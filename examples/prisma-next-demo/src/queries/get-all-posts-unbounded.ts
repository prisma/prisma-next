import { db } from '../prisma/db';
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
export async function getAllPostsUnbounded() {
  return collect(db.sql.post.select('id', 'title', 'userId', 'createdAt').all());
}
