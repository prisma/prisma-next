import { db } from '../prisma/db';
import { collect } from './utils';

/**
 * WARNING: This query intentionally violates the row budget to demonstrate
 * budget enforcement. It selects all posts without a LIMIT clause, which
 * will trigger a BUDGET.ROWS_EXCEEDED error.
 */
export async function getAllPostsUnbounded() {
  return collect(db.sql.post.select('id', 'title', 'userId', 'createdAt').all());
}
