import { param } from '@prisma-next/sql-relational-core/param';
import type { AnyColumnBuilder, AnyOrderBuilder } from '@prisma-next/sql-relational-core/types';
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

  // Type assertion needed because TypeScript needs help inferring the operation method
  // from OperationTypes when the column is nullable
  const embeddingColumn = postTable.columns.embedding as unknown as {
    cosineDistance: (arg: ReturnType<typeof param>) => AnyColumnBuilder & {
      asc(): AnyOrderBuilder;
      desc(): AnyOrderBuilder;
    };
  };

  const queryParam = param('queryVector');
  const distanceExpr = embeddingColumn.cosineDistance(queryParam);

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

  return collect(runtime.execute(plan));
}
