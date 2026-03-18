import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('limit with literal number', () => {
  const literalLimit = db.users.select('id', 'name').limit(10).firstOrThrow();

  expectTypeOf(literalLimit).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('offset with literal number', () => {
  const literalOffset = db.users.select('id', 'name').offset(5).firstOrThrow();

  expectTypeOf(literalOffset).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('limit with expression referencing a scope field', () => {
  const exprLimit = db.users
    .select('id', 'name')
    .limit((f) => f.id)
    .firstOrThrow();

  expectTypeOf(exprLimit).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('offset with expression referencing a scope field', () => {
  const exprOffset = db.users
    .select('id', 'name')
    .offset((f) => f.id)
    .firstOrThrow();

  expectTypeOf(exprOffset).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('both limit and offset with expressions', () => {
  const bothExpr = db.users
    .select('id', 'name')
    .limit((f) => f.id)
    .offset((f) => f.id)
    .firstOrThrow();

  expectTypeOf(bothExpr).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('mixed: literal limit + expression offset', () => {
  const mixed = db.users
    .select('id', 'name')
    .limit(10)
    .offset((f) => f.id)
    .firstOrThrow();

  expectTypeOf(mixed).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('expression pagination after join with namespaced access', () => {
  const joined = db.users
    .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
    .select('name', 'title')
    .limit((f) => f.posts.views)
    .offset((f) => f.users.id)
    .firstOrThrow();

  expectTypeOf(joined).toEqualTypeOf<Promise<{ name: string; title: string }>>();
});
