import { param } from '@prisma-next/sql-query/param';
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

  const plan = sql
    .from(postTable)
    .select({
      id: postTable.columns.id,
      title: postTable.columns.title,
      distance: postTable.columns.embedding.cosineDistance(param('queryVector')),
    })
    .orderBy(postTable.columns.embedding.cosineDistance(param('queryVector')).asc())
    .limit(limit)
    .build({ params: { queryVector } });

  return collect(runtime.execute(plan));
}
