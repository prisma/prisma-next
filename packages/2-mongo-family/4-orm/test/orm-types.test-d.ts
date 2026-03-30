import type { AsyncIterableResult } from '@prisma-next/runtime-executor';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../../5-runtime/test/fixtures/orm-contract';
import type {
  EmbedRelationKeys,
  InferFullRow,
  InferRootRow,
  MongoCollection,
  MongoIncludeSpec,
  MongoOrmClient,
  MongoWhereFilter,
  ReferenceRelationKeys,
} from '../src/types';

// --- Root accessors ---

test('ORM client has root accessors matching roots section', () => {
  type Client = MongoOrmClient<Contract>;
  expectTypeOf<Client>().toHaveProperty('tasks');
  expectTypeOf<Client>().toHaveProperty('users');
});

test('root accessors are MongoCollection instances', () => {
  type Client = MongoOrmClient<Contract>;
  expectTypeOf<Client['tasks']>().toMatchTypeOf<MongoCollection<Contract, 'Task'>>();
  expectTypeOf<Client['users']>().toMatchTypeOf<MongoCollection<Contract, 'User'>>();
});

// --- findMany return type ---

test('findMany returns AsyncIterableResult, not Promise', () => {
  type Client = MongoOrmClient<Contract>;
  type Result = ReturnType<Client['users']['findMany']>;
  expectTypeOf<Result>().toMatchTypeOf<AsyncIterableResult<unknown>>();
});

// --- Default row includes embedded fields ---

test('InferFullRow for User includes embedded addresses', () => {
  type UserRow = InferFullRow<Contract, 'User'>;
  expectTypeOf<UserRow>().toHaveProperty('_id');
  expectTypeOf<UserRow>().toHaveProperty('name');
  expectTypeOf<UserRow>().toHaveProperty('email');
  expectTypeOf<UserRow>().toHaveProperty('addresses');
});

test('embedded 1:N relation is an array of the embedded model row', () => {
  type UserRow = InferFullRow<Contract, 'User'>;
  type AddressRow = { street: string; city: string; zip: string };
  expectTypeOf<UserRow['addresses']>().toMatchTypeOf<AddressRow[]>();
});

test('InferFullRow for Task includes embedded comments', () => {
  type TaskRow = InferFullRow<Contract, 'Task'>;
  expectTypeOf<TaskRow>().toHaveProperty('comments');
});

test('InferFullRow for models without embeds matches field row', () => {
  type AddressRow = InferFullRow<Contract, 'Address'>;
  expectTypeOf<AddressRow>().toHaveProperty('street');
  expectTypeOf<AddressRow>().toHaveProperty('city');
  expectTypeOf<AddressRow>().toHaveProperty('zip');
});

// --- Where filter keys constrained to model fields ---

test('where filter keys are constrained to model field names', () => {
  type UserFilter = MongoWhereFilter<Contract, 'User'>;
  expectTypeOf<UserFilter>().toHaveProperty('_id');
  expectTypeOf<UserFilter>().toHaveProperty('name');
  expectTypeOf<UserFilter>().toHaveProperty('email');
});

// --- Include constrained to reference relations only ---

test('ReferenceRelationKeys picks only reference relations', () => {
  type TaskRefKeys = ReferenceRelationKeys<Contract, 'Task'>;
  expectTypeOf<TaskRefKeys>().toEqualTypeOf<'assignee'>();
});

test('EmbedRelationKeys picks only embed relations', () => {
  type TaskEmbedKeys = EmbedRelationKeys<Contract, 'Task'>;
  expectTypeOf<TaskEmbedKeys>().toEqualTypeOf<'comments'>();
});

test('MongoIncludeSpec only allows reference relation keys', () => {
  type TaskInclude = MongoIncludeSpec<Contract, 'Task'>;
  expectTypeOf<TaskInclude>().toHaveProperty('assignee');
  expectTypeOf<TaskInclude>().not.toHaveProperty('comments');
});

test('MongoIncludeSpec has no includable keys for models with only embed relations', () => {
  type UserRefKeys = ReferenceRelationKeys<Contract, 'User'>;
  expectTypeOf<UserRefKeys>().toBeNever();
});

// --- Polymorphic root returns discriminated union ---

test('InferRootRow for polymorphic model returns union of base+variant rows', () => {
  type TaskRow = InferRootRow<Contract, 'Task'>;

  type BugRowPart = { severity: string };
  type FeatureRowPart = { priority: string; targetRelease: string };

  expectTypeOf<TaskRow>().toMatchTypeOf<
    | ({ _id: string; title: string; type: string; assigneeId: string } & BugRowPart)
    | ({ _id: string; title: string; type: string; assigneeId: string } & FeatureRowPart)
  >();
});

test('InferRootRow for non-polymorphic model returns plain row', () => {
  type UserRow = InferRootRow<Contract, 'User'>;
  expectTypeOf<UserRow>().toHaveProperty('_id');
  expectTypeOf<UserRow>().toHaveProperty('name');
  expectTypeOf<UserRow>().toHaveProperty('email');
  expectTypeOf<UserRow>().toHaveProperty('addresses');
});
