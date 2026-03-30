import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('basic multi-column select', () => {
  const simple = db.users
    .select('id', 'email')
    .where((c, fns) => fns.eq(c.invited_by_id, c.id))
    .firstOrThrow();

  expectTypeOf(simple).toEqualTypeOf<Promise<{ id: number; email: string }>>();
});

test('aliased expression select after join', () => {
  const aliasedExpr = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
    .select('authorName', (f) => f.users.name)
    .firstOrThrow();

  expectTypeOf(aliasedExpr).toEqualTypeOf<Promise<{ authorName: string }>>();
});

test('bulk record select', () => {
  const bulk = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
    .select((f) => ({ userName: f.name, mail: f.email, postTitle: f.posts.title }))
    .firstOrThrow();

  expectTypeOf(bulk).toEqualTypeOf<
    Promise<{ userName: string; mail: string; postTitle: string }>
  >();
});

test('mixed usage combining all overloads', () => {
  const mixed = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
    .select('email', 'views')
    .select('authorName', (f) => f.users.name)
    .select((f) => ({ id: f.users.id, postTitle: f.title }))
    .firstOrThrow();

  expectTypeOf(mixed).toEqualTypeOf<
    Promise<{
      id: number;
      views: number;
      email: string;
      authorName: string;
      postTitle: string;
    }>
  >();
});
