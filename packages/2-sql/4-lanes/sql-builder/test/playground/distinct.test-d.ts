import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('distinct() on a basic select', () => {
  const distinctUsers = db.users.select('name', 'email').distinct().firstOrThrow();

  expectTypeOf(distinctUsers).toEqualTypeOf<Promise<{ name: string; email: string }>>();
});

test('distinctOn with a single column name', () => {
  const distinctOnName = db.users
    .select('name', 'email')
    .distinctOn('name')
    .orderBy('name')
    .firstOrThrow();

  expectTypeOf(distinctOnName).toEqualTypeOf<Promise<{ name: string; email: string }>>();
});

test('distinctOn with multiple column names', () => {
  const distinctOnMulti = db.users
    .select('name', 'email')
    .distinctOn('name', 'email')
    .orderBy('name')
    .firstOrThrow();

  expectTypeOf(distinctOnMulti).toEqualTypeOf<Promise<{ name: string; email: string }>>();
});

test('distinctOn with expression callback', () => {
  const distinctOnExpr = db.users
    .select('name', 'email')
    .distinctOn((f) => f.name)
    .orderBy('name')
    .firstOrThrow();

  expectTypeOf(distinctOnExpr).toEqualTypeOf<Promise<{ name: string; email: string }>>();
});

test('distinctOn with joined tables — namespace access in expression', () => {
  const distinctOnJoin = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .select('name', 'title')
    .distinctOn((f) => f.users.name)
    .orderBy((f) => f.users.name)
    .firstOrThrow();

  expectTypeOf(distinctOnJoin).toEqualTypeOf<Promise<{ name: string; title: string }>>();
});

test('distinct() on a grouped query', () => {
  const distinctGrouped = db.users
    .select('name')
    .select('cnt', (_f, fns) => fns.count())
    .groupBy('name')
    .distinct()
    .firstOrThrow();

  expectTypeOf(distinctGrouped).toEqualTypeOf<Promise<{ name: string; cnt: number }>>();
});

test('distinctOn on a grouped query', () => {
  const distinctOnGrouped = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .select('name')
    .select('postCount', (_f, fns) => fns.count())
    .groupBy('name')
    .distinctOn('name')
    .orderBy('name')
    .firstOrThrow();

  expectTypeOf(distinctOnGrouped).toEqualTypeOf<Promise<{ name: string; postCount: number }>>();
});

test('distinctOn referencing scope field not in select', () => {
  const distinctOnScope = db.users.select('name').distinctOn('id').orderBy('id').firstOrThrow();

  expectTypeOf(distinctOnScope).toEqualTypeOf<Promise<{ name: string }>>();
});
