import { expectTypeOf } from 'vitest';
import { db } from './preamble';

// EXISTS — users who have posts
const withPosts = await db.users
  .select('id', 'name')
  .where((f, fns) =>
    fns.exists(db.posts.select('id').where((pf, pfns) => pfns.eq(pf.user_id, f.users.id))),
  )
  .first();

expectTypeOf(withPosts).toEqualTypeOf<{ id: number; name: string }>();

// NOT EXISTS — users without posts
const withoutPosts = await db.users
  .select('id', 'name')
  .where((f, fns) =>
    fns.notExists(db.posts.select('id').where((pf, pfns) => pfns.eq(pf.user_id, f.users.id))),
  )
  .first();

expectTypeOf(withoutPosts).toEqualTypeOf<{ id: number; name: string }>();

// IN with subquery
const inSubquery = await db.users
  .select('id', 'name')
  .where((f, fns) => fns.in(f.users.id, db.posts.select('user_id')))
  .first();

expectTypeOf(inSubquery).toEqualTypeOf<{ id: number; name: string }>();

// IN with literal array
const inLiteral = await db.users
  .select('id', 'name')
  .where((f, fns) => fns.in(f.users.id, [1, 2, 3]))
  .first();

expectTypeOf(inLiteral).toEqualTypeOf<{ id: number; name: string }>();

// IN with expression array
const inExpressions = await db.users
  .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
  .select('name')
  .where((f, fns) => fns.in(f.users.id, [f.posts.user_id]))
  .first();

expectTypeOf(inExpressions).toEqualTypeOf<{ name: string }>();

// IN with mixed array (literals + expressions)
const inMixed = await db.users
  .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
  .select('name')
  .where((f, fns) => fns.in(f.users.id, [1, f.posts.user_id, 3]))
  .first();

expectTypeOf(inMixed).toEqualTypeOf<{ name: string }>();

// NOT IN with subquery
const notInSubquery = await db.users
  .select('id', 'name')
  .where((f, fns) => fns.notIn(f.users.id, db.posts.select('user_id')))
  .first();

expectTypeOf(notInSubquery).toEqualTypeOf<{ id: number; name: string }>();

// NOT IN with literal array
const notInLiteral = await db.users
  .select('id', 'name')
  .where((f, fns) => fns.notIn(f.users.id, [1, 2, 3]))
  .first();

expectTypeOf(notInLiteral).toEqualTypeOf<{ id: number; name: string }>();

// Type-mismatched subquery — title is text, id is int4
await db.users
  .select('id')
  // @ts-expect-error
  .where((f, fns) => fns.in(f.users.id, db.posts.select('title')))
  .first();

// Multi-column subquery with different types
await db.users
  .select('id')
  // @ts-expect-error
  .where((f, fns) => fns.in(f.users.id, db.posts.select('user_id', 'title')))
  .first();

// Type-mismatched literal array — strings vs int expression
await db.users
  .select('id')
  // @ts-expect-error
  .where((f, fns) => fns.in(f.users.id, ['hello', 'world']))
  .first();

// EXISTS with grouped subquery
const existsGrouped = await db.users
  .select('id', 'name')
  .where((_f, fns) =>
    fns.exists(
      db.posts
        .select('user_id')
        .select('cnt', (_pf, pfns) => pfns.count())
        .groupBy('user_id')
        .having((_pf, pfns) => pfns.gt(pfns.count(), 5)),
    ),
  )
  .first();

expectTypeOf(existsGrouped).toEqualTypeOf<{ id: number; name: string }>();
