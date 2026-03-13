import { expectTypeOf } from 'vitest';
import type { TableProxy } from '../src';
import type { CodecTypes, Tables } from './fixtures/generated/contract';

declare const users: TableProxy<CodecTypes, 'users', Tables['users']>;
declare const posts: TableProxy<CodecTypes, 'posts', Tables['posts']>;

// Basic multi-column select
const simple = await users
  .select('id', 'email')
  .where((c, fns) => fns.eq(c.invited_by_id, c.id))
  .first();

expectTypeOf(simple).toEqualTypeOf<{ id: number; email: string }>();

// Inner join
const inner = await users
  .innerJoin(posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
  .select('name', 'embedding')
  .first();

expectTypeOf(inner).toEqualTypeOf<{ name: string; embedding: number[] | null }>();

/// conflicting column names are not available at top level
await users
  .innerJoin(posts, (f, fns) => fns.eq(f.users.id, f.user_id))

  // @ts-expect-error f.id is not available without a namespace
  .select((f) => ({ id: f.id, title: f.posts.title }))
  .first();

// Outer left join makes right side nullable
const left = await users
  .outerLeftJoin(posts, (f, fns) => fns.eq(f.users.id, f.user_id))
  .select('name', 'title')
  .first();

expectTypeOf(left).toEqualTypeOf<{ name: string; title: string | null }>();

// Outer right join makes left side nullable
const right = await users
  .outerRightJoin(posts, (f, fns) => fns.eq(f.users.id, f.user_id))
  .select('name', 'title')
  .first();

expectTypeOf(right).toEqualTypeOf<{ name: string | null; title: string }>();

// Outer full join makes both sides nullable
const full = await users
  .outerFullJoin(posts, (f, fns) => fns.eq(f.users.id, f.user_id))
  .select('name', 'title')
  .first();

expectTypeOf(full).toEqualTypeOf<{ name: string | null; title: string | null }>();

// Field name conflict resolved via namespaces
const filedNameConflict = await users
  .innerJoin(posts, (f, fns) => fns.eq(f.users.id, f.user_id))
  .select('name', 'title')
  .where((f, fns) => fns.eq(f.users.id, f.posts.id))
  .first();

expectTypeOf(filedNameConflict).toEqualTypeOf<{ name: string; title: string }>();

// Aliased expression select after join
const aliasedExpr = await users
  .innerJoin(posts, (f, fns) => fns.eq(f.users.id, f.user_id))
  .select('authorName', (f) => f.users.name)
  .first();

expectTypeOf(aliasedExpr).toEqualTypeOf<{ authorName: string }>();

// Bulk record select
const bulk = await users
  .innerJoin(posts, (f, fns) => fns.eq(f.users.id, f.user_id))
  .select((f) => ({ userName: f.name, mail: f.email, postTitle: f.posts.title }))
  .first();

expectTypeOf(bulk).toEqualTypeOf<{ userName: string; mail: string; postTitle: string }>();

// Mixed usage combining all overloads
const mixed = await users
  .innerJoin(posts, (f, fns) => fns.eq(f.users.id, f.user_id))
  .select('email', 'views')
  .select('authorName', (f) => f.users.name)
  .select((f) => ({ id: f.users.id, postTitle: f.title }))
  .first();

expectTypeOf(mixed).toEqualTypeOf<{
  id: number;
  views: number;
  email: string;
  authorName: string;
  postTitle: string;
}>();

// Join an a subquery
const subquery = await users
  .innerJoin(
    posts.select((f) => ({ title: f.title, authorId: f.user_id })).as('myPosts'),
    (f, fns) => fns.eq(f.users.id, f.myPosts.authorId),
  )
  .select((f) => ({
    userName: f.users.name,
    postTitle: f.myPosts.title,
  }))
  .first();

expectTypeOf(subquery).toEqualTypeOf<{ userName: string; postTitle: string }>();

// Self-join: users joined to themselves via alias
const selfJoin = await users
  .innerJoin(users.as('inviter'), (f, fns) => fns.eq(f.users.invited_by_id, f.inviter.id))
  .select((f) => ({
    userName: f.users.name,
    inviterName: f.inviter.name,
  }))
  .first();

expectTypeOf(selfJoin).toEqualTypeOf<{ userName: string; inviterName: string }>();

// Basic lateral join — user with latest post title
const lateral = await users
  .lateralJoin('latestPost', (lateral) =>
    lateral
      .from(posts)
      .select('title')
      .where((f, fns) => fns.eq(f.users.id, f.posts.user_id)),
  )
  .select((f) => ({
    userName: f.users.name,
    postTitle: f.latestPost.title,
  }))
  .first();

expectTypeOf(lateral).toEqualTypeOf<{ userName: string; postTitle: string }>();

// Outer lateral join — nullable result columns
const outerLateral = await users
  .outerLateralJoin('latestPost', (lateral) =>
    lateral
      .from(posts)
      .select('title')
      .where((f, fns) => fns.eq(f.users.id, f.posts.user_id)),
  )
  .select((f) => ({
    userName: f.users.name,
    postTitle: f.latestPost.title,
  }))
  .first();

expectTypeOf(outerLateral).toEqualTypeOf<{ userName: string; postTitle: string | null }>();

// Lateral join chained with regular join
const lateralWithJoin = await users
  .innerJoin(posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
  .lateralJoin('sub', (lateral) =>
    lateral.from(posts.as('p2')).select((f) => ({ subTitle: f.p2.title })),
  )
  .select((f) => ({
    userName: f.users.name,
    subTitle: f.sub.subTitle,
  }))
  .first();

expectTypeOf(lateralWithJoin).toEqualTypeOf<{ userName: string; subTitle: string }>();

// Lateral subquery using expression select
const lateralExpr = await users
  .lateralJoin('computed', (lateral) =>
    lateral.from(posts).select('postTitle', (f) => f.posts.title),
  )
  .select((f) => ({
    userName: f.users.name,
    postTitle: f.computed.postTitle,
  }))
  .first();

expectTypeOf(lateralExpr).toEqualTypeOf<{ userName: string; postTitle: string }>();

// orderBy with select alias
const ordered = await users
  .select('authorName', (f) => f.name)
  .orderBy('authorName', { direction: 'desc', nulls: 'last' })
  .first();

expectTypeOf(ordered).toEqualTypeOf<{ authorName: string }>();

// orderBy with expression referencing alias
const orderedExpr = await users
  .select('authorName', (f) => f.name)
  .orderBy((f) => f.authorName, { direction: 'asc' })
  .first();

expectTypeOf(orderedExpr).toEqualTypeOf<{ authorName: string }>();

// orderBy with scope field (not in select)
const orderedScope = await users.select('name').orderBy('id').first();

expectTypeOf(orderedScope).toEqualTypeOf<{ name: string }>();
