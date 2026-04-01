import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('limit with literal number', () => {
  const literalLimit = db.users.select('id', 'name').limit(10).firstOrThrow();

  expectTypeOf(literalLimit).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('offset with literal number', () => {
  const literalOffset = db.users.select('id', 'name').offset(5).firstOrThrow();

  expectTypeOf(literalOffset).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('both limit and offset with literal numbers', () => {
  const both = db.users.select('id', 'name').limit(10).offset(5).firstOrThrow();

  expectTypeOf(both).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('pagination after join preserves row type', () => {
  const joined = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
    .select('name', 'title')
    .limit(10)
    .offset(5)
    .firstOrThrow();

  expectTypeOf(joined).toEqualTypeOf<Promise<{ name: string; title: string }>>();
});
