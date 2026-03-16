import { expectTypeOf } from 'vitest';
import { posts, users } from './preamble';

// Basic multi-column select
const simple = await users
  .select('id', 'email')
  .where((c, fns) => fns.eq(c.invited_by_id, c.id))
  .first();

expectTypeOf(simple).toEqualTypeOf<{ id: number; email: string }>();

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
