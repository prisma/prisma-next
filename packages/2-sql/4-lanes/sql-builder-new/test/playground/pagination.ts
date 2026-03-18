import { expectTypeOf } from 'vitest';
import { db } from './preamble';

// limit with literal number
const literalLimit = await db.users.select('id', 'name').limit(10).first();

expectTypeOf(literalLimit).toEqualTypeOf<{ id: number; name: string }>();

// offset with literal number
const literalOffset = await db.users.select('id', 'name').offset(5).first();

expectTypeOf(literalOffset).toEqualTypeOf<{ id: number; name: string }>();

// limit with expression referencing a scope field
const exprLimit = await db.users
  .select('id', 'name')
  .limit((f) => f.id)
  .first();

expectTypeOf(exprLimit).toEqualTypeOf<{ id: number; name: string }>();

// offset with expression referencing a scope field
const exprOffset = await db.users
  .select('id', 'name')
  .offset((f) => f.id)
  .first();

expectTypeOf(exprOffset).toEqualTypeOf<{ id: number; name: string }>();

// both limit and offset with expressions
const bothExpr = await db.users
  .select('id', 'name')
  .limit((f) => f.id)
  .offset((f) => f.id)
  .first();

expectTypeOf(bothExpr).toEqualTypeOf<{ id: number; name: string }>();

// mixed: literal limit + expression offset
const mixed = await db.users
  .select('id', 'name')
  .limit(10)
  .offset((f) => f.id)
  .first();

expectTypeOf(mixed).toEqualTypeOf<{ id: number; name: string }>();

// expression pagination after join with namespaced access
const joined = await db.users
  .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
  .select('name', 'title')
  .limit((f) => f.posts.views)
  .offset((f) => f.users.id)
  .first();

expectTypeOf(joined).toEqualTypeOf<{ name: string; title: string }>();
