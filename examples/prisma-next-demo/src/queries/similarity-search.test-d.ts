import { param } from '@prisma-next/sql-relational-core/param';
import type {
  AnyExpressionSource,
  AnyOrderBuilder,
  ResultType,
} from '@prisma-next/sql-relational-core/types';
import { expectTypeOf, test } from 'vitest';
import { db } from '../prisma/db';

/**
 * Type test to verify ResultType shape for similarity queries.
 */
test('ResultType exposes projected keys for similarity query result', () => {
  const postTable = db.schema.tables['post'];
  if (!postTable) throw new Error('post table not found');
  const postColumns = postTable.columns;
  const cosineDistance = (
    postColumns['embedding'] as unknown as { cosineDistance: (arg: unknown) => unknown }
  ).cosineDistance;
  const distanceExpr = cosineDistance(param('queryVector')) as AnyExpressionSource & {
    asc(): AnyOrderBuilder;
  };

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
  expectTypeOf({} as Row).toBeObject();
});
