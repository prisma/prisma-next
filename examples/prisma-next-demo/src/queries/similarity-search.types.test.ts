import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { ResultType } from '@prisma-next/contract/types';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql } from '@prisma-next/sql-lane/sql';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createRuntimeContext } from '@prisma-next/sql-runtime';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../prisma/contract.d';
import contractJson from '../prisma/contract.json' with { type: 'json' };

/**
 * Type test to verify that ResultType correctly infers the distance column as number
 * when using cosineDistance operation.
 */
test('ResultType correctly infers number for cosineDistance operation result', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({
    contract,
    adapter,
    extensions: [pgvector()],
  });

  const tables = schema(context).tables;
  const postTable = tables.post;
  if (!postTable) throw new Error('post table not found');

  const queryParam = param('queryVector');
  const distanceExpr = postTable.columns.embedding.cosineDistance(queryParam);

  const _plan = sql({ context })
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
