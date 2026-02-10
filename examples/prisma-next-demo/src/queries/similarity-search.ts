import { param } from '@prisma-next/sql-relational-core/param';
import type { AnyExpressionSource, AnyOrderBuilder } from '@prisma-next/sql-relational-core/types';
import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';
import { collect } from './utils';

/**
 * Search for posts by cosine distance to a query vector.
 * Returns the top N posts ordered by similarity (closest first).
 */
export async function similaritySearch(queryVector: number[], runtime: Runtime, limit = 10) {
  const postTable = db.schema.tables['post'];
  if (!postTable) {
    throw new Error('post table not found');
  }
  const postColumns = postTable.columns;
  const cosineDistance = (
    postColumns['embedding'] as unknown as { cosineDistance: (arg: unknown) => unknown }
  ).cosineDistance;
  const distanceExpr = cosineDistance(param('queryVector')) as AnyExpressionSource & {
    asc(): AnyOrderBuilder;
  };

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
