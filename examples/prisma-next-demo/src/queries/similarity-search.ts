import type { ResultType } from '@prisma-next/contract';
import { param } from '@prisma-next/sql-relational-core/param';
import { sql, tables } from '../prisma/query';
import { getRuntime } from '../prisma/runtime';
import { collect } from './utils';

/**
 * Search for posts by cosine distance to a query vector.
 * Returns the top N posts ordered by similarity (closest first).
 */
export async function similaritySearch(queryVector: number[], limit = 10) {
  const runtime = getRuntime();
  const postTable = tables.post;

  const queryParam = param('queryVector');

  const plan = sql
    .from(postTable)
    .select({
      id: postTable.columns.id,
      title: postTable.columns.title,
      distance: postTable.columns.embedding.cosineDistance(queryParam),
    })
    .orderBy(postTable.columns.embedding.cosineDistance(queryParam).asc())
    .limit(limit)
    .build({ params: { queryVector } });
  type Row = ResultType<typeof plan>;
  // Type-level test: verify distance is correctly inferred as number
  type _distance = Row['distance'];

  return collect(runtime.execute(plan));
}
