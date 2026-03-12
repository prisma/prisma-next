import { expectTypeOf } from 'vitest';
import type { DefaultScope, SelectQueryBuilder } from '../src';
import type { CodecTypes, Tables } from './fixtures/generated/contract';

declare const users: SelectQueryBuilder<CodecTypes, DefaultScope<'users', Tables['users']>>;
declare const posts: SelectQueryBuilder<CodecTypes, DefaultScope<'posts', Tables['posts']>>;

// Basic column select
const simple = await users
  .select('id')
  .select('email')
  .where((f, fns) => fns.eq(f.invited_by_id, f.id))
  .first();

expectTypeOf(simple).toEqualTypeOf<{ id: number; email: string }>();

// Inner join
const inner = await users
  .innerJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('name')
  .select('embedding')
  .first();

expectTypeOf(inner).toEqualTypeOf<{ name: string; embedding: number[] | null }>();

// Outer left join makes right side nullable
const left = await users
  .outerLeftJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('name')
  .select('title')
  .first();

expectTypeOf(left).toEqualTypeOf<{ name: string; title: string | null }>();

// Outer right join makes left side nullable
const right = await users
  .outerRightJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('name')
  .select('title')
  .first();

expectTypeOf(right).toEqualTypeOf<{ name: string | null; title: string }>();

// Outer full join makes both sides nullable
const full = await users
  .outerFullJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('name')
  .select('title')
  .first();

expectTypeOf(full).toEqualTypeOf<{ name: string | null; title: string | null }>();

// Field name conflict resolved via namespaces
const filedNameConflict = await users
  .innerJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .where((f, fns) => fns.eq(f.users.id, f.posts.id))
  .select('name')
  .select('title');

void filedNameConflict;

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
const bulk = await users.select((f) => ({ userName: f.name, mail: f.email })).first();

expectTypeOf(bulk).toEqualTypeOf<{ userName: string; mail: string }>();

// Mixed usage combining all overloads
const mixed = await users
  .innerJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('id')
  .select('userName', 'name')
  .select('authorName', (f) => f.users.name)
  .select((f) => ({ postTitle: f.posts.title }))
  .first();

expectTypeOf(mixed).toEqualTypeOf<{
  id: number;
  userName: string;
  authorName: string;
  postTitle: string;
}>();
