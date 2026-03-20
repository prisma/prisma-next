import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('basic groupBy with count', () => {
  const postsPerUser = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .select('name')
    .select('postCount', (_f, fns) => fns.count())
    .groupBy('name')
    .firstOrThrow();

  expectTypeOf(postsPerUser).toEqualTypeOf<Promise<{ name: string; postCount: number }>>();
});

test('groupBy with select alias', () => {
  const byAlias = db.users
    .select('author', (f) => f.name)
    .select('total', (_f, fns) => fns.count())
    .groupBy('author')
    .firstOrThrow();

  expectTypeOf(byAlias).toEqualTypeOf<Promise<{ author: string; total: number }>>();
});

test('HAVING with aggregate expression', () => {
  const activeAuthors = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .select('name')
    .select('postCount', (f, fns) => fns.count(f.posts.id))
    .groupBy('name')
    .having((_f, fns) => fns.gt(fns.count(), 5))
    .firstOrThrow();

  expectTypeOf(activeAuthors).toEqualTypeOf<Promise<{ name: string; postCount: number }>>();
});

test('HAVING referencing a select alias', () => {
  const havingAlias = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .select('name')
    .select('postCount', (_f, fns) => fns.count())
    .groupBy('name')
    .having((f, fns) => fns.gt(f.postCount, 5))
    .firstOrThrow();

  expectTypeOf(havingAlias).toEqualTypeOf<Promise<{ name: string; postCount: number }>>();
});

test('chained groupBy', () => {
  const multiGroup = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .select('name', 'title')
    .select('cnt', (_f, fns) => fns.count())
    .groupBy('name')
    .groupBy('title')
    .firstOrThrow();

  expectTypeOf(multiGroup).toEqualTypeOf<Promise<{ name: string; title: string; cnt: number }>>();
});

test('groupBy with expression', () => {
  const byExpr = db.users
    .select('email')
    .select('userCount', (_f, fns) => fns.count())
    .groupBy((f) => f.email)
    .firstOrThrow();

  expectTypeOf(byExpr).toEqualTypeOf<Promise<{ email: string; userCount: number }>>();
});

test('ORDER BY aggregate on grouped query', () => {
  const orderedGroup = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .select('name')
    .select('postCount', (_f, fns) => fns.count())
    .groupBy('name')
    .orderBy((_f, fns) => fns.count(), { direction: 'desc' })
    .limit(10)
    .firstOrThrow();

  expectTypeOf(orderedGroup).toEqualTypeOf<Promise<{ name: string; postCount: number }>>();
});

test('grouped subquery as join source', () => {
  const withCounts = db.users
    .innerJoin(
      db.posts
        .select('user_id')
        .select('postCount', (_f, fns) => fns.count())
        .groupBy('user_id')
        .as('pc'),
      (f, fns) => fns.eq(f.users.id, f.pc.user_id),
    )
    .select((f) => ({ name: f.users.name, postCount: f.pc.postCount }))
    .firstOrThrow();

  expectTypeOf(withCounts).toEqualTypeOf<Promise<{ name: string; postCount: number }>>();
});

test('sum/avg/min/max aggregate functions', () => {
  const aggregates = db.posts
    .select('totalViews', (f, fns) => fns.sum(f.views))
    .select('avgViews', (f, fns) => fns.avg(f.views))
    .select('minViews', (f, fns) => fns.min(f.views))
    .select('maxViews', (f, fns) => fns.max(f.views))
    .groupBy((f) => f.user_id)
    .firstOrThrow();

  expectTypeOf(aggregates).toEqualTypeOf<
    Promise<{
      totalViews: number | null;
      avgViews: number | null;
      minViews: number | null;
      maxViews: number | null;
    }>
  >();
});

test('aggregates in select are allowed (fns.count available)', () => {
  const selectAgg = db.users
    .select('name')
    .select('cnt', (_f, fns) => fns.count())
    .firstOrThrow();

  expectTypeOf(selectAgg).toEqualTypeOf<Promise<{ name: string; cnt: number }>>();
});

test('aggregates in WHERE — type error', () => {
  db.users
    .select('name')
    // @ts-expect-error count is not available in where (Functions, not AggregateFunctions)
    .where((_f, fns) => fns.gt(fns.count(), 5))
    .firstOrThrow();
});

test('HAVING without GROUP BY — type error', () => {
  db.users
    .select('name')
    // @ts-expect-error having only exists on GroupedQuery, not SelectQuery
    .having((_f, fns) => fns.gt(fns.count(), 5))
    .firstOrThrow();
});
