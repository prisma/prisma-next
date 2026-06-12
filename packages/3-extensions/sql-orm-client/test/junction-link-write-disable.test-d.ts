import type { Contract as ContractShape } from '@prisma-next/contract/types';
import type { ContractWithTypeMaps } from '@prisma-next/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { MutationCreateInput, MutationUpdateInput } from '../src/types';
import type { Contract, Models, TypeMaps } from './fixtures/generated/contract';

type RoleCreate = MutationCreateInput<Contract, 'Role'>;
type TagCreate = MutationCreateInput<Contract, 'Tag'>;
type RoleUpdate = MutationUpdateInput<Contract, 'Role'>;

const roleCreate = { id: 'admin', name: 'Admin' } as RoleCreate;
const tagCreate = { id: 'featured', name: 'Featured' } as TagCreate;
const roleCriterion = { id: 'admin' } as { readonly id: NonNullable<RoleCreate['id']> };
const tagCriterion = { id: 'featured' } as { readonly id: NonNullable<TagCreate['id']> };
const roleUpdate = { name: 'Admin' } as RoleUpdate;

type ShadowJunctionModel = {
  readonly fields: {
    readonly userId: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
    };
    readonly tagId: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
    };
    readonly shadowLevel: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
    };
  };
  readonly relations: Record<string, never>;
  readonly storage: {
    readonly table: 'user_tags';
    readonly namespaceId: 'shadow';
    readonly fields: {
      readonly userId: { readonly column: 'user_id' };
      readonly tagId: { readonly column: 'tag_id' };
      readonly shadowLevel: { readonly column: 'shadow_level' };
    };
  };
};

type ShadowedContract = ContractWithTypeMaps<
  ContractShape<Contract['storage'], Models & { readonly ShadowUserTag: ShadowJunctionModel }>,
  TypeMaps
>;

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

test('connect on a required-payload junction relation is a type error', () => {
  type Input = MutationCreateInput<Contract, 'User'>;

  const input: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    roles: (mutator) =>
      // @ts-expect-error - connect also INSERTs a junction row and can't supply the required `level` payload column
      mutator.connect(roleCriterion),
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

test('bare disconnect on a junction relation is a type error', () => {
  type Input = MutationUpdateInput<Contract, 'User'>;

  const input: Input = {
    tags: (mutator) =>
      // @ts-expect-error - junction disconnect requires a target criterion to avoid broad junction deletes
      mutator.disconnect(),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('connect on a required-payload junction relation is a type error in update input', () => {
  type Input = MutationUpdateInput<Contract, 'User'>;

  const input: Input = {
    roles: (mutator) =>
      // @ts-expect-error - update connect also INSERTs a junction row and can't supply the required `level` payload column
      mutator.connect(roleCriterion),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('criteria disconnect remains available on a required-payload junction relation in update input', () => {
  type Input = MutationUpdateInput<Contract, 'User'>;

  const input: Input = {
    roles: (mutator) => mutator.disconnect([roleCriterion]),
  };

  expectTypeOf(input).toExtend<Input>();
});

test('update payloads remain available for target models behind required-payload junctions', () => {
  expectTypeOf(roleUpdate).toExtend<RoleUpdate>();
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

test('pure junction relation lookup is namespace-aware', () => {
  type Input = MutationCreateInput<ShadowedContract, 'User'>;

  const input: Input = {
    name: 'Alice',
    email: 'alice@test.com',
    tags: (mutator) => mutator.connect(tagCriterion),
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
