import type { Char } from '@prisma-next/adapter-postgres/codec-types';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { sql } from '@prisma-next/sql-lane/sql';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { test } from 'vitest';
import type { Contract } from '../prisma/contract.d';
import contractJson from '../prisma/contract.json' with { type: 'json' };

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

/**
 * Type test to verify that ResultType correctly infers the distance column as number
 * when using cosineDistance operation.
 */
test('ResultType correctly infers number for cosineDistance operation result', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter, { extensionPacks: [pgvector] });

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

  // Compile-time assertions
  type Assertions = [
    Expect<Equal<Row['distance'], number>>,
    Expect<Equal<Row['id'], Char<36>>>,
    Expect<Equal<Row['title'], string>>,
  ];
  const assertions = null as unknown as Assertions;
  void assertions;
});
