import { param } from '@prisma-next/sql-relational-core/param';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { expectTypeOf, test } from 'vitest';
import { sql, tables } from '../prisma/query';

/**
 * Type test to verify that ResultType correctly infers the distance column as number
 * when using cosineDistance operation.
 */
test('ResultType correctly infers number for cosineDistance operation result', () => {
  const postTable = tables.post;
  const queryParam = param('queryVector');
  const distanceExpr = postTable.columns.embedding.cosineDistance(queryParam);

  const _plan = sql
    .from(postTable)
    .select({
      id: postTable.columns.id,
      title: postTable.columns.title,
      distance: distanceExpr,
    })
    .orderBy(distanceExpr.asc())
    .limit(10)
    .build({ params: { queryVector: [1, 2, 3] } });

  type Row = ResultType<typeof _plan>;

  // Verify that distance is correctly inferred as number
  expectTypeOf<Row['distance']>().toEqualTypeOf<number>();
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['title']>().toEqualTypeOf<string>();
});
