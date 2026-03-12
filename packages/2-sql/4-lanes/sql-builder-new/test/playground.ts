import { expectTypeOf } from 'vitest';
import type { TableProxy } from '../src';
import type { CodecTypes, Tables } from './fixtures/generated/contract';

declare const users: TableProxy<CodecTypes, 'users', Tables['users']>;
declare const posts: TableProxy<CodecTypes, 'posts', Tables['posts']>;

// Basic multi-column select
const simple = await users
  .select('id', 'email')
  .where((f, fns) => fns.eq(f.invited_by_id, f.id))
  .first();

expectTypeOf(simple).toEqualTypeOf<{ id: number; email: string }>();

// Inner join
const inner = await users
  .innerJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('name', 'embedding')
  .first();

expectTypeOf(inner).toEqualTypeOf<{ name: string; embedding: number[] | null }>();

// Outer left join makes right side nullable
const left = await users
  .outerLeftJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('name', 'title')
  .first();

expectTypeOf(left).toEqualTypeOf<{ name: string; title: string | null }>();

// Outer right join makes left side nullable
const right = await users
  .outerRightJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('name', 'title')
  .first();

expectTypeOf(right).toEqualTypeOf<{ name: string | null; title: string }>();

// Outer full join makes both sides nullable
const full = await users
  .outerFullJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('name', 'title')
  .first();

expectTypeOf(full).toEqualTypeOf<{ name: string | null; title: string | null }>();

// Field name conflict resolved via namespaces
const filedNameConflict = await users
  .innerJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('name', 'title')
  .where((f, fns) => fns.eq(f.users.id, f.posts.id))
  .first();

expectTypeOf(filedNameConflict).toEqualTypeOf<{ name: string; title: string }>();

// Aliased column select
const aliased = await users.select('userName', 'name').first();

expectTypeOf(aliased).toEqualTypeOf<{ userName: string }>();

// Aliased expression select after join
const aliasedExpr = await users
  .innerJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('authorName', (f) => f.users.name)
  .first();

expectTypeOf(aliasedExpr).toEqualTypeOf<{ authorName: string }>();

// Bulk record select
const bulk = await users
  .innerJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select((f) => ({ userName: f.name, mail: f.email, postTitle: f.posts.title }))
  .first();

expectTypeOf(bulk).toEqualTypeOf<{ userName: string; mail: string; postTitle: string }>();

// Mixed usage combining all overloads
const mixed = await users
  .innerJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('id', 'views')
  .select('userName', 'name')
  .select('authorName', (f) => f.users.name)
  .select((f) => ({ postTitle: f.posts.title }))
  .first();

expectTypeOf(mixed).toEqualTypeOf<{
  id: number;
  views: number;
  userName: string;
  authorName: string;
  postTitle: string;
}>();
