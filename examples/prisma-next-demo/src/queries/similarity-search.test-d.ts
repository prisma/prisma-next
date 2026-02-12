import { param } from '@prisma-next/sql-relational-core/param';
import type {
  AnyExpressionSource,
  AnyOrderBuilder,
  ResultType,
} from '@prisma-next/sql-relational-core/types';
import { expectTypeOf, test } from 'vitest';
import { db } from '../prisma/db';

type VectorDistanceExpression = AnyExpressionSource & {
  asc(): AnyOrderBuilder;
};

type VectorOpsColumn = {
  cosineDistance(arg: unknown): VectorDistanceExpression;
};

function hasVectorOpsColumn(value: unknown): value is VectorOpsColumn {
  return typeof value === 'object' && value !== null && 'cosineDistance' in value;
}

/**
 * Type test to verify ResultType shape for similarity queries.
 */
test('ResultType exposes projected keys for similarity query result', () => {
  const postTable = db.schema.tables.post;
  if (!postTable) throw new Error('post table not found');
  const postColumns = postTable.columns;
  const embeddingColumn = postColumns.embedding;
  if (!hasVectorOpsColumn(embeddingColumn)) {
    throw new Error('embedding column does not expose vector operations');
  }
  const distanceExpr = embeddingColumn.cosineDistance(param('queryVector'));

  const _plan = db.sql
    .from(postTable)
    .select({
      id: postColumns.id,
      title: postColumns.title,
      distance: distanceExpr,
    })
    .orderBy(distanceExpr.asc())
    .limit(10)
    .build({ params: { queryVector: [1, 2, 3] } });

  type Row = ResultType<typeof _plan>;
  expectTypeOf<Row>().toExtend<{
    id: unknown;
    title: unknown;
    distance: unknown;
  }>();
});
