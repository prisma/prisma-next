import type { Char } from '@prisma-next/adapter-postgres/codec-types';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { sql } from '@prisma-next/sql-lane/sql';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../prisma/contract.d';
import contractJson from '../prisma/contract.json' with { type: 'json' };

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

  // Verify that embedding is correctly inferred as number[] | null (nullable vector column)
  expectTypeOf<Row['embedding']>().toEqualTypeOf<number[] | null>();
  expectTypeOf<Row['id']>().toEqualTypeOf<Char<36>>();
  expectTypeOf<Row['title']>().toEqualTypeOf<string>();
  expectTypeOf<Row['userId']>().toEqualTypeOf<string>();
  // Note: createdAt type depends on codec definition - checking it's not never
  expectTypeOf<Row['createdAt']>().not.toEqualTypeOf<never>();
});
