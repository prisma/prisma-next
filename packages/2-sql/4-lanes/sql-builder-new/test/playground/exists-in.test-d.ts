import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('EXISTS — users who have posts', () => {
  const withPosts = db.users
    .select('id', 'name')
    .where((f, fns) =>
      fns.exists(db.posts.select('id').where((pf, pfns) => pfns.eq(pf.user_id, f.users.id))),
    )
    .firstOrThrow();

  expectTypeOf(withPosts).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('NOT EXISTS — users without posts', () => {
  const withoutPosts = db.users
    .select('id', 'name')
    .where((f, fns) =>
      fns.notExists(db.posts.select('id').where((pf, pfns) => pfns.eq(pf.user_id, f.users.id))),
    )
    .firstOrThrow();

  expectTypeOf(withoutPosts).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('IN with subquery', () => {
  const inSubquery = db.users
    .select('id', 'name')
    .where((f, fns) => fns.in(f.users.id, db.posts.select('user_id')))
    .firstOrThrow();

  expectTypeOf(inSubquery).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('IN with literal array', () => {
  const inLiteral = db.users
    .select('id', 'name')
    .where((f, fns) => fns.in(f.users.id, [1, 2, 3]))
    .firstOrThrow();

  expectTypeOf(inLiteral).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('IN with expression array', () => {
  const inExpressions = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .select('name')
    .where((f, fns) => fns.in(f.users.id, [f.posts.user_id]))
    .firstOrThrow();

  expectTypeOf(inExpressions).toEqualTypeOf<Promise<{ name: string }>>();
});

test('IN with mixed array (literals + expressions)', () => {
  const inMixed = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .select('name')
    .where((f, fns) => fns.in(f.users.id, [1, f.posts.user_id, 3]))
    .firstOrThrow();

  expectTypeOf(inMixed).toEqualTypeOf<Promise<{ name: string }>>();
});

test('NOT IN with subquery', () => {
  const notInSubquery = db.users
    .select('id', 'name')
    .where((f, fns) => fns.notIn(f.users.id, db.posts.select('user_id')))
    .firstOrThrow();

  expectTypeOf(notInSubquery).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('NOT IN with literal array', () => {
  const notInLiteral = db.users
    .select('id', 'name')
    .where((f, fns) => fns.notIn(f.users.id, [1, 2, 3]))
    .firstOrThrow();

  expectTypeOf(notInLiteral).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('type-mismatched subquery — title is text, id is int4', () => {
  db.users
    .select('id')
    // @ts-expect-error
    .where((f, fns) => fns.in(f.users.id, db.posts.select('title')))
    .firstOrThrow();
});

test('multi-column subquery with different types', () => {
  db.users
    .select('id')
    // @ts-expect-error
    .where((f, fns) => fns.in(f.users.id, db.posts.select('user_id', 'title')))
    .firstOrThrow();
});

test('type-mismatched literal array — strings vs int expression', () => {
  db.users
    .select('id')
    // @ts-expect-error
    .where((f, fns) => fns.in(f.users.id, ['hello', 'world']))
    .firstOrThrow();
});

test('EXISTS with grouped subquery', () => {
  const existsGrouped = db.users
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
    .firstOrThrow();

  expectTypeOf(existsGrouped).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});
