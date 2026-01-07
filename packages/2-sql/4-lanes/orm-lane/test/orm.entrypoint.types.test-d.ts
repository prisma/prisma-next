import type { ExtractCodecTypes, SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { OrmRegistry } from '../src/orm-types.ts';
import type { Contract } from './fixtures/contract.d.js';

// Helper type to get OrmRegistry type for a contract
type OrmRegistryFor<TContract extends SqlContract<SqlStorage>> = OrmRegistry<
  TContract,
  ExtractCodecTypes<TContract>
>;

test('orm exposes only valid model names', () => {
  type OrmRegistry = OrmRegistryFor<Contract>;

  expectTypeOf<OrmRegistry>().toHaveProperty('User');
  expectTypeOf<OrmRegistry>().not.toHaveProperty('invalidModel');
});

test('model access returns OrmModelBuilder', () => {
  type OrmRegistry = OrmRegistryFor<Contract>;
  type UserBuilder = ReturnType<OrmRegistry['User']>;

  expectTypeOf<UserBuilder>().toHaveProperty('where');
  expectTypeOf<UserBuilder>().toHaveProperty('select');
  expectTypeOf<UserBuilder>().toHaveProperty('findMany');
  expectTypeOf<UserBuilder>().toHaveProperty('findFirst');
  expectTypeOf<UserBuilder>().toHaveProperty('findUnique');
});

test('invalid model access rejected at compile time', () => {
  type OrmRegistry = OrmRegistryFor<Contract>;

  expectTypeOf<OrmRegistry>().not.toHaveProperty('invalidModel');
});
