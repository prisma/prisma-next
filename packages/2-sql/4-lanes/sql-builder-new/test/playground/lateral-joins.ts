import { expectTypeOf } from 'vitest';
import { posts, users } from './preamble';

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
