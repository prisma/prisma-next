import { param } from '@prisma-next/sql-relational-core/param';
import type { AnyExpressionSource, AnyOrderBuilder } from '@prisma-next/sql-relational-core/types';
import type { Runtime } from '@prisma-next/sql-runtime';
import { demoSchema, demoSql } from '../prisma/context';
import { collect } from './utils';

type VectorDistanceExpression = AnyExpressionSource & {
  asc(): AnyOrderBuilder;
};

type VectorOpsColumn = {
  cosineDistance(arg: unknown): VectorDistanceExpression;
};

function hasVectorOpsColumn(value: unknown): value is VectorOpsColumn {
  return (
    typeof value === 'object' &&
    value !== null &&
    'cosineDistance' in value &&
    typeof (value as { cosineDistance?: unknown }).cosineDistance === 'function'
  );
}

/**
 * Search for posts by cosine distance to a query vector.
 * Returns the top N posts ordered by similarity (closest first).
 */
export async function similaritySearch(queryVector: number[], runtime: Runtime, limit = 10) {
  const postTable = demoSchema.tables.post;
  if (!postTable) {
    throw new Error('post table not found');
  }
  const postColumns = postTable.columns;
  const embeddingColumn = postColumns.embedding;
  if (!hasVectorOpsColumn(embeddingColumn)) {
    throw new Error('embedding column does not expose vector operations');
  }
  const distanceExpr = embeddingColumn.cosineDistance(param('queryVector'));

  const plan = demoSql
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
