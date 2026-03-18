import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('inner join', () => {
  const inner = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .select('name', 'embedding')
    .firstOrThrow();

  expectTypeOf(inner).toEqualTypeOf<Promise<{ name: string; embedding: number[] | null }>>();
});

test('conflicting column names are not available at top level', () => {
  db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
    // @ts-expect-error f.id is not available without a namespace
    .select((f) => ({ id: f.id, title: f.posts.title }))
    .firstOrThrow();
});

test('outer left join makes right side nullable', () => {
  const left = db.users
    .outerLeftJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
    .select('name', 'title')
    .firstOrThrow();

  expectTypeOf(left).toEqualTypeOf<Promise<{ name: string; title: string | null }>>();
});

test('outer right join makes left side nullable', () => {
  const right = db.users
    .outerRightJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
    .select('name', 'title')
    .firstOrThrow();

  expectTypeOf(right).toEqualTypeOf<Promise<{ name: string | null; title: string }>>();
});

test('outer full join makes both sides nullable', () => {
  const full = db.users
    .outerFullJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
    .select('name', 'title')
    .firstOrThrow();

  expectTypeOf(full).toEqualTypeOf<Promise<{ name: string | null; title: string | null }>>();
});

test('field name conflict resolved via namespaces', () => {
  const fieldNameConflict = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
    .select('name', 'title')
    .where((f, fns) => fns.eq(f.users.id, f.posts.id))
    .firstOrThrow();

  expectTypeOf(fieldNameConflict).toEqualTypeOf<Promise<{ name: string; title: string }>>();
});

test('join on a subquery', () => {
  const subquery = db.users
    .innerJoin(
      db.posts.select((f) => ({ title: f.title, authorId: f.user_id })).as('myPosts'),
      (f, fns) => fns.eq(f.users.id, f.myPosts.authorId),
    )
    .select((f) => ({
      userName: f.users.name,
      postTitle: f.myPosts.title,
    }))
    .firstOrThrow();

  expectTypeOf(subquery).toEqualTypeOf<Promise<{ userName: string; postTitle: string }>>();
});

test('self-join via alias', () => {
  const selfJoin = db.users
    .innerJoin(db.users.as('inviter'), (f, fns) => fns.eq(f.users.invited_by_id, f.inviter.id))
    .select((f) => ({
      userName: f.users.name,
      inviterName: f.inviter.name,
    }))
    .firstOrThrow();

  expectTypeOf(selfJoin).toEqualTypeOf<Promise<{ userName: string; inviterName: string }>>();
});
