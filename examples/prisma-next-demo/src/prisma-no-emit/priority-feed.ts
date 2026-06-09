import type { Runtime } from '@prisma-next/sql-runtime';
import { createOrmClient, sql } from './context';

/**
 * Reads posts ordered by their `Priority` enum column. The enum's declaration
 * order (low -> high -> urgent) drives the sort, not lexical order, so the feed
 * surfaces the lowest-priority posts first.
 */
export async function getPostsByPriority(runtime: Runtime) {
  const rows = await runtime.execute(
    sql.post.select('id', 'title', 'priority').orderBy('priority').orderBy('id').build(),
  );
  return rows;
}

/**
 * Returns the declaration-ordered runtime surface for the `Priority` enum via
 * `db.enums`, demonstrating that the value tuple and helpers are reachable from
 * the orm client.
 */
export function getPriorityEnum(runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.enums.Priority;
}
