import mongoFamily from '@prisma-next/family-mongo/pack';
import { defineContract, field, model } from '@prisma-next/mongo-contract-ts/contract-builder';
import mongoTarget from '@prisma-next/target-mongo/pack';
import { describe, expect, it } from 'vitest';

describe('Mongo pack composition', () => {
  it('composes the official Mongo family and target packs with TS authoring', () => {
    const User = model('User', {
      collection: 'users',
      fields: {
        _id: field.objectId(),
        email: field.string(),
      },
    });

    const contract = defineContract({
      family: mongoFamily,
      target: mongoTarget,
      models: { User },
    });

    expect(contract).toMatchObject({
      targetFamily: 'mongo',
      target: 'mongo',
      roots: {
        users: 'User',
      },
      storage: {
        collections: {
          users: {},
        },
      },
    });
  });
});
