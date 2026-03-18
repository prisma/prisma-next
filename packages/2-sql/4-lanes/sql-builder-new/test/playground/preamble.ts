import type { TableProxy } from '../../src';
import type { Contract } from '../fixtures/generated/contract';

declare const users: TableProxy<Contract, 'users'>;
declare const posts: TableProxy<Contract, 'posts'>;

export { users, posts };
