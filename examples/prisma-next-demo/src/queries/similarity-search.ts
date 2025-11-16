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
  const distanceExpr = postTable.columns.embedding.cosineDistance(queryParam);

  const plan = sql
    .from(postTable)
    .select({
      id: postTable.columns.id,
      title: postTable.columns.title,
      distance: distanceExpr,
    })
    .orderBy(distanceExpr.asc())
    .limit(limit)
    .build({ params: { queryVector } });

  type Row = ResultType<typeof plan>;
  // @ts-expect-error - This is to test the type inference
  type _Test = Row['distance']; // This is correctly inferred as number

  return collect(runtime.execute(plan));
}
