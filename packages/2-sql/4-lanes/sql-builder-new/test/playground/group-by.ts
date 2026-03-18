import { expectTypeOf } from 'vitest';
import { db } from './preamble';

// Basic groupBy with count
const postsPerUser = await db.users
  .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
  .select('name')
  .select('postCount', (_f, fns) => fns.count())
  .groupBy('name')
  .first();

expectTypeOf(postsPerUser).toEqualTypeOf<{ name: string; postCount: number }>();

// groupBy with select alias
const byAlias = await db.users
  .select('author', (f) => f.name)
  .select('total', (_f, fns) => fns.count())
  .groupBy('author')
  .first();

expectTypeOf(byAlias).toEqualTypeOf<{ author: string; total: number }>();

// HAVING with aggregate expression
const activeAuthors = await db.users
  .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
  .select('name')
  .select('postCount', (f, fns) => fns.count(f.posts.id))
  .groupBy('name')
  .having((_f, fns) => fns.gt(fns.count(), 5))
  .first();

expectTypeOf(activeAuthors).toEqualTypeOf<{ name: string; postCount: number }>();

// HAVING referencing a select alias
const havingAlias = await db.users
  .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
  .select('name')
  .select('postCount', (_f, fns) => fns.count())
  .groupBy('name')
  .having((f, fns) => fns.gt(f.postCount, 5))
  .first();

expectTypeOf(havingAlias).toEqualTypeOf<{ name: string; postCount: number }>();

// Chained groupBy
const multiGroup = await db.users
  .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
  .select('name', 'title')
  .select('cnt', (_f, fns) => fns.count())
  .groupBy('name')
  .groupBy('title')
  .first();

expectTypeOf(multiGroup).toEqualTypeOf<{ name: string; title: string; cnt: number }>();

// groupBy with expression
const byExpr = await db.users
  .select('email')
  .select('userCount', (_f, fns) => fns.count())
  .groupBy((f) => f.email)
  .first();

expectTypeOf(byExpr).toEqualTypeOf<{ email: string; userCount: number }>();

// ORDER BY aggregate on grouped query
const orderedGroup = await db.users
  .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
  .select('name')
  .select('postCount', (_f, fns) => fns.count())
  .groupBy('name')
  .orderBy((_f, fns) => fns.count(), { direction: 'desc' })
  .limit(10)
  .first();

expectTypeOf(orderedGroup).toEqualTypeOf<{ name: string; postCount: number }>();

// Grouped subquery as join source
const withCounts = await db.users
  .innerJoin(
    db.posts
      .select('user_id')
      .select('postCount', (_f, fns) => fns.count())
      .groupBy('user_id')
      .as('pc'),
    (f, fns) => fns.eq(f.users.id, f.pc.user_id),
  )
  .select((f) => ({ name: f.users.name, postCount: f.pc.postCount }))
  .first();

expectTypeOf(withCounts).toEqualTypeOf<{ name: string; postCount: number }>();

// sum/avg/min/max aggregate functions
const aggregates = await db.posts
  .select('totalViews', (f, fns) => fns.sum(f.views))
  .select('avgViews', (f, fns) => fns.avg(f.views))
  .select('minViews', (f, fns) => fns.min(f.views))
  .select('maxViews', (f, fns) => fns.max(f.views))
  .groupBy((f) => f.user_id)
  .first();

expectTypeOf(aggregates).toEqualTypeOf<{
  totalViews: number | null;
  avgViews: number | null;
  minViews: number | null;
  maxViews: number | null;
}>();

// Aggregates in select are allowed (fns.count available)
const selectAgg = await db.users
  .select('name')
  .select('cnt', (_f, fns) => fns.count())
  .first();

expectTypeOf(selectAgg).toEqualTypeOf<{ name: string; cnt: number }>();

// ❌ Aggregates in WHERE — type error
await db.users
  .select('name')
  // @ts-expect-error count is not available in where (Functions, not AggregateFunctions)
  .where((_f, fns) => fns.gt(fns.count(), 5))
  .first();

// ❌ HAVING without GROUP BY — type error
await db.users
  .select('name')
  // @ts-expect-error having only exists on GroupedQuery, not SelectQuery
  .having((_f, fns) => fns.gt(fns.count(), 5))
  .first();
