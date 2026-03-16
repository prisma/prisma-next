import type { TableProxy } from '../../src';
import type { CodecTypes, Tables } from '../fixtures/generated/contract';

declare const users: TableProxy<CodecTypes, 'users', Tables['users']>;
declare const posts: TableProxy<CodecTypes, 'posts', Tables['posts']>;

export { users, posts };
