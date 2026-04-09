import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type { InferModelRow } from '@prisma-next/mongo-contract';
import { expectTypeOf, test } from 'vitest';
import { defineContract, field, model, valueObject } from '../src/contract-builder';

const mongoFamilyPack = {
  kind: 'family',
  id: 'mongo',
  familyId: 'mongo',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'mongo'>;

const mongoTargetPack = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

const Address = valueObject('Address', {
  fields: {
    street: field.string(),
    zip: field.string().optional(),
  },
});

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.objectId(),
    homeAddress: field.valueObject(Address).optional(),
    previousAddresses: field.valueObject(Address).many(),
  },
});

const contract = defineContract({
  family: mongoFamilyPack,
  target: mongoTargetPack,
  models: { User },
  valueObjects: { Address },
});

type UserRow = InferModelRow<typeof contract, 'User'>;

test('contract roots stay specific', () => {
  expectTypeOf(contract.roots.users).toEqualTypeOf<'User'>();
});

test('value object rows flow through InferModelRow', () => {
  expectTypeOf<UserRow['_id']>().toEqualTypeOf<string>();
  expectTypeOf<UserRow['homeAddress']>().toEqualTypeOf<{
    street: string;
    zip: string | null;
  } | null>();
  expectTypeOf<UserRow['previousAddresses']>().toEqualTypeOf<
    {
      street: string;
      zip: string | null;
    }[]
  >();
});
