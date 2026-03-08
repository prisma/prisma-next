import type { Char } from '@prisma-next/adapter-postgres/codec-types';
import type { Vector } from '@prisma-next/extension-pgvector/codec-types';
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

// Manual type assertions: expectTypeOf produces false positives with branded types
// like Vector<1536> and Char<36> because it erases the brand during comparison.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type NotNever<T> = [T] extends [never] ? false : true;

/**
 * Type test to verify that ResultType correctly infers number[] | null for nullable vector column.
 * This matches the actual query in get-user-posts.ts.
 */
test('ResultType correctly infers number[] | null for nullable embedding column', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter, { extensionPacks: [pgvector] });

  const tables = schema(context).tables;
  const postTable = tables.post;
  if (!postTable) throw new Error('post table not found');

  const _plan = sql({ context })
    .from(postTable)
    .where(postTable.columns.userId.eq(param('userId')))
    .select({
      id: postTable.columns.id,
      title: postTable.columns.title,
      userId: postTable.columns.userId,
      createdAt: postTable.columns.createdAt,
      embedding: postTable.columns.embedding,
    })
    .build({ params: { userId: 'user_001' } });

  type Row = ResultType<typeof _plan>;

  // Compile-time assertions
  type Assertions = [
    Expect<Equal<Row['embedding'], Vector<1536> | null>>,
    Expect<Equal<Row['id'], Char<36>>>,
    Expect<Equal<Row['title'], string>>,
    Expect<Equal<Row['userId'], string>>,
    Expect<NotNever<Row['createdAt']>>,
  ];
  const assertions = null as unknown as Assertions;
  void assertions;
});
