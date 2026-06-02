import { expectTypeOf, test } from 'vitest';
import type { MutationCreateInput } from '../src/types';
import type { Contract } from './fixtures/generated/contract';

type RoleCreate = MutationCreateInput<Contract, 'Role'>;
type TagCreate = MutationCreateInput<Contract, 'Tag'>;

const roleCreate = { id: 'admin', name: 'Admin' } as RoleCreate;
const tagCreate = { id: 'featured', name: 'Featured' } as TagCreate;
const roleCriterion = { id: 'admin' } as { readonly id: NonNullable<RoleCreate['id']> };
const tagCriterion = { id: 'featured' } as { readonly id: NonNullable<TagCreate['id']> };

test('nested create on a relation whose junction has a required payload column is a type error', () => {
  type Input = MutationCreateInput<Contract, 'User'>;

  const input: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    roles: (mutator) =>
      // @ts-expect-error - User.roles junction `user_roles` carries required column `level` the relation API can't populate, so nested create is disabled
      mutator.create(roleCreate),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('connect remains available on a required-payload junction relation', () => {
  type Input = MutationCreateInput<Contract, 'User'>;

  const input: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    roles: (mutator) => mutator.connect(roleCriterion),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('disconnect remains available on a required-payload junction relation', () => {
  type Input = MutationCreateInput<Contract, 'User'>;

  const input: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    roles: (mutator) => mutator.disconnect([roleCriterion]),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('nested create on a pure junction relation is allowed', () => {
  type Input = MutationCreateInput<Contract, 'User'>;

  const input: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    tags: (mutator) => mutator.create(tagCreate),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('connect and disconnect remain available on a pure junction relation', () => {
  type Input = MutationCreateInput<Contract, 'User'>;

  const connectInput: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    tags: (mutator) => mutator.connect(tagCriterion),
  };

  const disconnectInput: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    tags: (mutator) => mutator.disconnect([tagCriterion]),
  };

  expectTypeOf(connectInput).toExtend<Input>();
  expectTypeOf(disconnectInput).toExtend<Input>();
});
