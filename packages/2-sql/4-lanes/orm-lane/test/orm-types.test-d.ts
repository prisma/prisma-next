import type { ExtractCodecTypes, SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { ModelColumnAccessor, OrmModelBuilder, OrmRegistry } from '../src/orm-types.ts';
import type { CodecTypes, Contract } from './fixtures/contract.d.js';
import type {
  CodecTypes as CodecTypesWithRelations,
  Contract as ContractWithRelations,
} from './fixtures/contract-with-relations.d.js';

// Helper type to get OrmRegistry type for a contract
type OrmRegistryFor<TContract extends SqlContract<SqlStorage>> = OrmRegistry<
  TContract,
  ExtractCodecTypes<TContract>
>;

// Test with contract without relations
test('OrmRegistry exposes model names', () => {
  type Registry = OrmRegistryFor<Contract>;

  expectTypeOf<Registry>().toHaveProperty('User');
  expectTypeOf<Registry>().not.toHaveProperty('InvalidModel');
});

test('OrmRegistry exposes lowercase model names', () => {
  type Registry = OrmRegistryFor<Contract>;

  expectTypeOf<Registry>().toHaveProperty('user');
  expectTypeOf<Registry['user']>().toEqualTypeOf<Registry['User']>();
});

test('OrmModelBuilder has all required methods', () => {
  type Registry = OrmRegistryFor<Contract>;
  type UserBuilder = ReturnType<Registry['User']>;

  expectTypeOf<UserBuilder>().toHaveProperty('where');
  expectTypeOf<UserBuilder>().toHaveProperty('include');
  expectTypeOf<UserBuilder>().toHaveProperty('orderBy');
  expectTypeOf<UserBuilder>().toHaveProperty('take');
  expectTypeOf<UserBuilder>().toHaveProperty('skip');
  expectTypeOf<UserBuilder>().toHaveProperty('select');
  expectTypeOf<UserBuilder>().toHaveProperty('findMany');
  expectTypeOf<UserBuilder>().toHaveProperty('findFirst');
  expectTypeOf<UserBuilder>().toHaveProperty('findUnique');
  expectTypeOf<UserBuilder>().toHaveProperty('create');
  expectTypeOf<UserBuilder>().toHaveProperty('update');
  expectTypeOf<UserBuilder>().toHaveProperty('delete');
});

test('ModelColumnAccessor provides column builders for model fields', () => {
  type Accessor = ModelColumnAccessor<Contract, CodecTypes, 'User'>;

  expectTypeOf<Accessor>().toHaveProperty('id');
  expectTypeOf<Accessor>().toHaveProperty('email');
  expectTypeOf<Accessor>().toHaveProperty('createdAt');
  // Verify invalidField is not in the accessor
  type AccessorKeys = keyof Accessor;
  expectTypeOf<AccessorKeys>().not.toEqualTypeOf<'invalidField'>();
});

test('where() is callable function', () => {
  type Registry = OrmRegistryFor<Contract>;
  type UserBuilder = ReturnType<Registry['User']>;
  type WhereProperty = UserBuilder['where'];

  expectTypeOf<WhereProperty>().toBeFunction();
});

test('where.related is empty when contract has no relations', () => {
  type Registry = OrmRegistryFor<Contract>;
  type UserBuilder = ReturnType<Registry['User']>;
  type WhereProperty = UserBuilder['where'];

  expectTypeOf<WhereProperty>().toHaveProperty('related');
  expectTypeOf<WhereProperty['related']>().toEqualTypeOf<Record<string, never>>();
});

test('include is empty when contract has no relations', () => {
  type Registry = OrmRegistryFor<Contract>;
  type UserBuilder = ReturnType<Registry['User']>;
  type IncludeAccessor = UserBuilder['include'];

  // When there are no relations, include should be Record<string, never>
  expectTypeOf<IncludeAccessor>().toMatchTypeOf<Record<string, never>>();
});

// Test with contract with relations
test('where.related exposes relations when contract has relations', () => {
  type Registry = OrmRegistryFor<ContractWithRelations>;
  type UserBuilder = ReturnType<Registry['User']>;
  type WhereProperty = UserBuilder['where'];

  expectTypeOf<WhereProperty>().toHaveProperty('related');
  expectTypeOf<WhereProperty['related']>().toHaveProperty('posts');
  expectTypeOf<WhereProperty['related']['posts']>().toHaveProperty('some');
  expectTypeOf<WhereProperty['related']['posts']>().toHaveProperty('none');
  expectTypeOf<WhereProperty['related']['posts']>().toHaveProperty('every');
});

test('where.related.posts.some returns OrmModelBuilder', () => {
  type Registry = OrmRegistryFor<ContractWithRelations>;
  type UserBuilder = ReturnType<Registry['User']>;
  type WhereProperty = UserBuilder['where'];
  type PostsRelationAccessor = WhereProperty['related']['posts'];
  type SomeFn = PostsRelationAccessor['some'];

  expectTypeOf<SomeFn>().toBeFunction();
  expectTypeOf<ReturnType<SomeFn>>().toExtend<
    OrmModelBuilder<ContractWithRelations, CodecTypesWithRelations, 'User', Record<string, never>>
  >();
});

test('where.related.posts.some is callable function', () => {
  type Registry = OrmRegistryFor<ContractWithRelations>;
  type UserBuilder = ReturnType<Registry['User']>;
  type WhereProperty = UserBuilder['where'];
  type PostsRelationAccessor = WhereProperty['related']['posts'];
  type SomeFn = PostsRelationAccessor['some'];

  expectTypeOf<SomeFn>().toBeFunction();
});

test('include exposes relations when contract has relations', () => {
  type Registry = OrmRegistryFor<ContractWithRelations>;
  type UserBuilder = ReturnType<Registry['User']>;
  type IncludeAccessor = UserBuilder['include'];

  expectTypeOf<IncludeAccessor>().toHaveProperty('posts');
  expectTypeOf<IncludeAccessor['posts']>().toBeFunction();
});

test('include.posts is callable function', () => {
  type Registry = OrmRegistryFor<ContractWithRelations>;
  type UserBuilder = ReturnType<Registry['User']>;
  type IncludeAccessor = UserBuilder['include'];
  type PostsIncludeFn = IncludeAccessor['posts'];

  expectTypeOf<PostsIncludeFn>().toBeFunction();
});

test('include.posts returns OrmModelBuilder', () => {
  type Registry = OrmRegistryFor<ContractWithRelations>;
  type UserBuilder = ReturnType<Registry['User']>;
  type IncludeAccessor = UserBuilder['include'];
  type PostsIncludeFn = IncludeAccessor['posts'];

  expectTypeOf<ReturnType<PostsIncludeFn>>().toExtend<
    OrmModelBuilder<ContractWithRelations, CodecTypesWithRelations, 'User', Record<string, never>>
  >();
});

test('select() infers row type from projection', () => {
  type Registry = OrmRegistryFor<Contract>;
  type UserBuilder = ReturnType<Registry['User']>;
  type SelectFn = UserBuilder['select'];

  expectTypeOf<SelectFn>().toBeFunction();
  expectTypeOf<ReturnType<SelectFn>>().toExtend<
    OrmModelBuilder<Contract, CodecTypes, 'User', Record<string, never>>
  >();
});

test('OrmWhereProperty is callable and has related property', () => {
  type Registry = OrmRegistryFor<ContractWithRelations>;
  type UserBuilder = ReturnType<Registry['User']>;
  type WhereProperty = UserBuilder['where'];

  expectTypeOf<WhereProperty>().toBeFunction();
  expectTypeOf<WhereProperty>().toHaveProperty('related');
});

test('OrmIncludeAccessor is object type, not empty, when relations exist', () => {
  type Registry = OrmRegistryFor<ContractWithRelations>;
  type UserBuilder = ReturnType<Registry['User']>;
  type IncludeAccessor = UserBuilder['include'];

  expectTypeOf<IncludeAccessor>().not.toEqualTypeOf<never>();
  expectTypeOf<IncludeAccessor>().not.toEqualTypeOf<Record<string, never>>();
  expectTypeOf<IncludeAccessor>().toHaveProperty('posts');
});

test('Post model has user relation accessor', () => {
  type Registry = OrmRegistryFor<ContractWithRelations>;
  type PostBuilder = ReturnType<Registry['Post']>;
  type WhereProperty = PostBuilder['where'];

  expectTypeOf<WhereProperty['related']>().toHaveProperty('user');
  expectTypeOf<WhereProperty['related']['user']>().toHaveProperty('some');
  expectTypeOf<WhereProperty['related']['user']>().toHaveProperty('none');
  expectTypeOf<WhereProperty['related']['user']>().toHaveProperty('every');
});

test('Post model has user include accessor', () => {
  type Registry = OrmRegistryFor<ContractWithRelations>;
  type PostBuilder = ReturnType<Registry['Post']>;
  type IncludeAccessor = PostBuilder['include'];

  expectTypeOf<IncludeAccessor>().toHaveProperty('user');
  expectTypeOf<IncludeAccessor['user']>().toBeFunction();
});
