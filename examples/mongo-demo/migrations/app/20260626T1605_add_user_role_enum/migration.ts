#!/usr/bin/env -S node
import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { Migration } from '@prisma-next/family-mongo/migration';
import { collMod } from '@prisma-next/target-mongo/migration';
import type { Contract as End } from '../../snapshots/79b46070809bf632b3742219ce1dd8924daf6350b2f478c4732962cf96288b6e/contract';
import endContract from '../../snapshots/79b46070809bf632b3742219ce1dd8924daf6350b2f478c4732962cf96288b6e/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/2827cbad7293fe13a4fb2aab60a55d3cddd856a86d1f6ccea6e11519faacff92/contract';
import startContract from '../../snapshots/2827cbad7293fe13a4fb2aab60a55d3cddd856a86d1f6ccea6e11519faacff92/contract.json' with {
  type: 'json',
};

class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      collMod(
        'users',
        {
          validator: {
            $jsonSchema: {
              additionalProperties: false,
              bsonType: 'object',
              properties: {
                _id: { bsonType: 'objectId' },
                address: {
                  oneOf: [
                    { bsonType: 'null' },
                    {
                      additionalProperties: false,
                      bsonType: 'object',
                      properties: {
                        city: { bsonType: 'string' },
                        country: { bsonType: 'string' },
                        street: { bsonType: 'string' },
                        zip: { bsonType: ['null', 'string'] },
                      },
                      required: ['city', 'country', 'street'],
                    },
                  ],
                },
                bio: { bsonType: ['null', 'string'] },
                email: { bsonType: 'string' },
                name: { bsonType: 'string' },
                role: { bsonType: 'string', enum: ['admin', 'author', 'reader'] },
              },
              required: ['_id', 'email', 'name', 'role'],
            },
          },
          validationLevel: 'strict',
          validationAction: 'error',
        },
        {
          id: 'validator.users.update',
          label: 'Update validator on users',
          operationClass: 'destructive',
        },
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
