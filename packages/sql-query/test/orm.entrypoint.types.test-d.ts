import { expectTypeOf, test } from 'vitest';
import type { orm } from '../src/orm';
import type { CodecTypes, Contract } from './fixtures/contract.d';

test('orm exposes only valid model names', () => {
  type OrmRegistry = ReturnType<typeof orm<Contract, CodecTypes>>;

  expectTypeOf<OrmRegistry>().toHaveProperty('User');
  expectTypeOf<OrmRegistry>().not.toHaveProperty('invalidModel');
});

test('model access returns OrmModelBuilder', () => {
  type OrmRegistry = ReturnType<typeof orm<Contract, CodecTypes>>;
  type UserBuilder = ReturnType<OrmRegistry['User']>;

  expectTypeOf<UserBuilder>().toHaveProperty('where');
  expectTypeOf<UserBuilder>().toHaveProperty('select');
  expectTypeOf<UserBuilder>().toHaveProperty('findMany');
  expectTypeOf<UserBuilder>().toHaveProperty('findFirst');
  expectTypeOf<UserBuilder>().toHaveProperty('findUnique');
});

test('invalid model access rejected at compile time', () => {
  type OrmRegistry = ReturnType<typeof orm<Contract, CodecTypes>>;

  // @ts-expect-error - invalidModel should not exist
  type InvalidAccess = OrmRegistry['invalidModel'];
});
