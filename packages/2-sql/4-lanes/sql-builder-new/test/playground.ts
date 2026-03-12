import type { DefaultScope, SelectBuilder } from '../src';
import type { CodecTypes, Tables } from './fixtures/generated/contract';

declare const users: SelectBuilder<CodecTypes, DefaultScope<Tables['users']>>;
declare const posts: SelectBuilder<CodecTypes, DefaultScope<Tables['posts']>>;

const simple = await users
  .select('id')
  .select('email')
  .where((f, fns) => fns.eq(f.invited_by_id, f.id))
  .first();

void simple;

const inner = await users
  .innerJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('name')
  .select('embedding')
  .first();

void inner;

const left = await users
  .outerLeftJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('name')
  .select('embedding')
  .first();

void left;

const right = await users
  .outerRightJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('name')
  .select('title')
  .first();

void right;

const full = await users
  .outerFullJoin(posts, (f, fns) => fns.eq(f.id, f.user_id))
  .select('name')
  .select('title')
  .first();

void full;
