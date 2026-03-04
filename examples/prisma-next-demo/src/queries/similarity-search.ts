import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { collect } from './utils';

/**
 * Search for posts by cosine distance to a query vector.
 * Returns the top N posts ordered by similarity (closest first).
 */
export async function similaritySearch(queryVector: number[], runtime: Runtime, limit = 10) {
  const postTable = db.schema.tables.post;
  const postColumns = postTable.columns;
  const embeddingColumn = postColumns.embedding;

  const distanceExpr = embeddingColumn.cosineDistance(param('queryVector'));

  const plan = db.sql
    .from(postTable)
    .select({
      id: postColumns.id,
      title: postColumns.title,
      distance: distanceExpr,
    })
    .orderBy(distanceExpr.asc())
    .limit(limit)
    .build({ params: { queryVector } });

  return collect(runtime.execute(plan));
}
