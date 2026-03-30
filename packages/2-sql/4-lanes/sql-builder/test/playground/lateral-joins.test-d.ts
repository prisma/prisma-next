import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('basic lateral join — user with latest post title', () => {
  const lateral = db.users
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
    .firstOrThrow();

  expectTypeOf(lateral).toEqualTypeOf<Promise<{ userName: string; postTitle: string }>>();
});

test('outer lateral join — nullable result columns', () => {
  const outerLateral = db.users
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
    .firstOrThrow();

  expectTypeOf(outerLateral).toEqualTypeOf<
    Promise<{ userName: string; postTitle: string | null }>
  >();
});

test('lateral join chained with regular join', () => {
  const lateralWithJoin = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .lateralJoin('sub', (lateral) =>
      lateral.from(db.posts.as('p2')).select((f) => ({ subTitle: f.p2.title })),
    )
    .select((f) => ({
      userName: f.users.name,
      subTitle: f.sub.subTitle,
    }))
    .firstOrThrow();

  expectTypeOf(lateralWithJoin).toEqualTypeOf<Promise<{ userName: string; subTitle: string }>>();
});

test('lateral subquery using expression select', () => {
  const lateralExpr = db.users
    .lateralJoin('computed', (lateral) =>
      lateral.from(db.posts).select('postTitle', (f) => f.posts.title),
    )
    .select((f) => ({
      userName: f.users.name,
      postTitle: f.computed.postTitle,
    }))
    .firstOrThrow();

  expectTypeOf(lateralExpr).toEqualTypeOf<Promise<{ userName: string; postTitle: string }>>();
});
