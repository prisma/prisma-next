import { expectTypeOf } from 'vitest';
import { db } from './preamble';

// Basic lateral join — user with latest post title
const lateral = await db.users
  .lateralJoin('latestPost', (lateral) =>
    lateral
      .from(db.posts)
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
const outerLateral = await db.users
  .outerLateralJoin('latestPost', (lateral) =>
    lateral
      .from(db.posts)
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
const lateralWithJoin = await db.users
  .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
  .lateralJoin('sub', (lateral) =>
    lateral.from(db.posts.as('p2')).select((f) => ({ subTitle: f.p2.title })),
  )
  .select((f) => ({
    userName: f.users.name,
    subTitle: f.sub.subTitle,
  }))
  .first();

expectTypeOf(lateralWithJoin).toEqualTypeOf<{ userName: string; subTitle: string }>();

// Lateral subquery using expression select
const lateralExpr = await db.users
  .lateralJoin('computed', (lateral) =>
    lateral.from(db.posts).select('postTitle', (f) => f.posts.title),
  )
  .select((f) => ({
    userName: f.users.name,
    postTitle: f.computed.postTitle,
  }))
  .first();

expectTypeOf(lateralExpr).toEqualTypeOf<{ userName: string; postTitle: string }>();
