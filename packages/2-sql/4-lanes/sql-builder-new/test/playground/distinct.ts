import { expectTypeOf } from 'vitest';
import { db } from './preamble';

// distinct() on a basic select
const distinctUsers = await db.users.select('name', 'email').distinct().first();

expectTypeOf(distinctUsers).toEqualTypeOf<{ name: string; email: string }>();

// distinctOn with a single column name
const distinctOnName = await db.users
  .select('name', 'email')
  .distinctOn('name')
  .orderBy('name')
  .first();

expectTypeOf(distinctOnName).toEqualTypeOf<{ name: string; email: string }>();

// distinctOn with multiple column names
const distinctOnMulti = await db.users
  .select('name', 'email')
  .distinctOn('name', 'email')
  .orderBy('name')
  .first();

expectTypeOf(distinctOnMulti).toEqualTypeOf<{ name: string; email: string }>();

// distinctOn with expression callback
const distinctOnExpr = await db.users
  .select('name', 'email')
  .distinctOn((f) => f.name)
  .orderBy('name')
  .first();

expectTypeOf(distinctOnExpr).toEqualTypeOf<{ name: string; email: string }>();

// distinctOn with joined tables — namespace access in expression
const distinctOnJoin = await db.users
  .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
  .select('name', 'title')
  .distinctOn((f) => f.users.name)
  .orderBy((f) => f.users.name)
  .first();

expectTypeOf(distinctOnJoin).toEqualTypeOf<{ name: string; title: string }>();

// distinct() on a grouped query
const distinctGrouped = await db.users
  .select('name')
  .select('cnt', (_f, fns) => fns.count())
  .groupBy('name')
  .distinct()
  .first();

expectTypeOf(distinctGrouped).toEqualTypeOf<{ name: string; cnt: number }>();

// distinctOn on a grouped query
const distinctOnGrouped = await db.users
  .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
  .select('name')
  .select('postCount', (_f, fns) => fns.count())
  .groupBy('name')
  .distinctOn('name')
  .orderBy('name')
  .first();

expectTypeOf(distinctOnGrouped).toEqualTypeOf<{ name: string; postCount: number }>();

// distinctOn referencing scope field not in select
const distinctOnScope = await db.users.select('name').distinctOn('id').orderBy('id').first();

expectTypeOf(distinctOnScope).toEqualTypeOf<{ name: string }>();
