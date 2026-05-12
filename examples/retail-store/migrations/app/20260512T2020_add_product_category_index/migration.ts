#!/usr/bin/env -S node
import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { Migration } from '@prisma-next/family-mongo/migration';
import { collMod, createIndex } from '@prisma-next/target-mongo/migration';

class M extends Migration {
  override describe() {
    return {
      from: 'sha256:4407077380e2331b356697c35153192b3bdafadb432f0d64b081d24e8af3e55a',
      to: 'sha256:8a15f8e37a3a8731578a87102f9507da65b5f84556f84320ea0ead82645e394d',
    };
  }

  override get operations() {
    return [
      createIndex(
        'products',
        [
          { direction: 1, field: 'masterCategory' },
          { direction: 1, field: 'articleType' },
        ],
        {},
      ),
      collMod(
        'products',
        {
          validator: {
            $jsonSchema: {
              bsonType: 'object',
              properties: {
                _id: { bsonType: 'objectId' },
                articleType: { bsonType: 'string' },
                brand: { bsonType: 'string' },
                code: { bsonType: 'string' },
                description: { bsonType: 'string' },
                image: {
                  bsonType: 'object',
                  properties: { url: { bsonType: 'string' } },
                  required: ['url'],
                },
                masterCategory: { bsonType: 'string' },
                name: { bsonType: 'string' },
                price: {
                  bsonType: 'object',
                  properties: { amount: { bsonType: 'double' }, currency: { bsonType: 'string' } },
                  required: ['amount', 'currency'],
                },
                subCategory: { bsonType: 'string' },
              },
              required: [
                '_id',
                'articleType',
                'brand',
                'code',
                'description',
                'image',
                'masterCategory',
                'name',
                'price',
                'subCategory',
              ],
            },
          },
          validationLevel: 'strict',
          validationAction: 'error',
        },
        {
          id: 'validator.products.update',
          label: 'Update validator on products',
          operationClass: 'destructive',
        },
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
