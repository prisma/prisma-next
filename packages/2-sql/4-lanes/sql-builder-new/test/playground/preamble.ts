import type { DefaultScope, TableProxy } from '../../src';
import type { CodecTypes, Contract, Tables } from '../fixtures/generated/contract';

type Capabilities = Contract['capabilities'];

declare const users: TableProxy<
  CodecTypes,
  'users',
  Tables['users'],
  'users',
  DefaultScope<'users', Tables['users']>,
  Capabilities
>;
declare const posts: TableProxy<
  CodecTypes,
  'posts',
  Tables['posts'],
  'posts',
  DefaultScope<'posts', Tables['posts']>,
  Capabilities
>;

export { users, posts };
