import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('extension function in select expression', () => {
  const withDistance = db.posts
    .select('id')
    .select('distance', (f, fns) => fns.cosineDistance(f.embedding, f.embedding))
    .build();

  expectTypeOf(withDistance).toEqualTypeOf<SqlQueryPlan<{ id: number; distance: number }>>();
});

test('extension function in orderBy', () => {
  const ordered = db.posts
    .select('id', 'title')
    .orderBy((f, fns) => fns.cosineDistance(f.embedding, [1, 2, 3]))
    .build();

  expectTypeOf(ordered).toEqualTypeOf<SqlQueryPlan<{ id: number; title: string }>>();
});

test('extension function composed with builtins in where', () => {
  const filtered = db.posts
    .select('id', 'title')
    .where((f, fns) => fns.lt(fns.cosineDistance(f.embedding, [1, 2, 3]), 0.5))
    .build();

  expectTypeOf(filtered).toEqualTypeOf<SqlQueryPlan<{ id: number; title: string }>>();
});
