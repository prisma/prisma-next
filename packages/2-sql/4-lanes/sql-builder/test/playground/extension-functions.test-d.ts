import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { expectTypeOf, test } from 'vitest';
import type { BooleanCodecType, Expression } from '../../src/expression';
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

test('ilike filters text fields in where', () => {
  const filtered = db.users
    .select('id', 'name')
    .where((f, fns) => fns.ilike(f.name, '%alice%'))
    .build();

  expectTypeOf(filtered).toEqualTypeOf<SqlQueryPlan<{ id: number; name: string }>>();
});

test('ilike returns boolean expression', () => {
  db.users.select('id').where((f, fns) => {
    const result = fns.ilike(f.name, '%test%');
    expectTypeOf(result).toExtend<Expression<BooleanCodecType>>();
    return result;
  });
});
