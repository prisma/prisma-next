import { param } from '@prisma-next/sql-relational-core/param';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { expectTypeOf, test } from 'vitest';
import { sql, tables } from '../prisma/query';

/**
 * Type test to verify that ResultType correctly infers number[] | null for nullable vector column.
 * This matches the actual query in get-user-posts.ts.
 */
test('ResultType correctly infers number[] | null for nullable embedding column', () => {
  const postTable = tables.post;

  const _plan = sql
    .from(postTable)
    .where(postTable.columns.userId.eq(param('userId')))
    .select({
      id: postTable.columns.id,
      title: postTable.columns.title,
      userId: postTable.columns.userId,
      createdAt: postTable.columns.createdAt,
      embedding: postTable.columns.embedding,
    })
    .build({ params: { userId: 1 } });

  type Row = ResultType<typeof _plan>;

  expectTypeOf<Row['embedding']>().toEqualTypeOf<number[] | null>();
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['title']>().toEqualTypeOf<string>();
  expectTypeOf<Row['userId']>().toEqualTypeOf<number>();
  expectTypeOf<Row['createdAt']>().not.toEqualTypeOf<never>();
});
