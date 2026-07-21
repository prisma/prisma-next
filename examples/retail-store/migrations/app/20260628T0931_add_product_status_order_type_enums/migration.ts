#!/usr/bin/env -S node
import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { Migration } from '@prisma-next/family-mongo/migration';
import { collMod } from '@prisma-next/target-mongo/migration';
import type { Contract as Start } from '../../snapshots/71f1cc5c3f4de1ea7c9c8426fde682cd78c7c005f6688f58c2d9d6ddd8b2284c/contract';
import startContract from '../../snapshots/71f1cc5c3f4de1ea7c9c8426fde682cd78c7c005f6688f58c2d9d6ddd8b2284c/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/950513819883fab7f2e961cfbea6ba069bec18ff2df023f9d0c9d6836c51feec/contract';
import endContract from '../../snapshots/950513819883fab7f2e961cfbea6ba069bec18ff2df023f9d0c9d6836c51feec/contract.json' with {
  type: 'json',
};

class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      collMod(
        'orders',
        {
          validator: {
            $jsonSchema: {
              additionalProperties: false,
              bsonType: 'object',
              properties: {
                _id: { bsonType: 'objectId' },
                items: {
                  bsonType: 'array',
                  items: {
                    additionalProperties: false,
                    bsonType: 'object',
                    properties: {
                      amount: { bsonType: 'int' },
                      brand: { bsonType: 'string' },
                      image: {
                        additionalProperties: false,
                        bsonType: 'object',
                        properties: { url: { bsonType: 'string' } },
                        required: ['url'],
                      },
                      name: { bsonType: 'string' },
                      price: {
                        additionalProperties: false,
                        bsonType: 'object',
                        properties: {
                          amount: { bsonType: 'double' },
                          currency: { bsonType: 'string' },
                        },
                        required: ['amount', 'currency'],
                      },
                      productId: { bsonType: 'string' },
                    },
                    required: ['amount', 'brand', 'image', 'name', 'price', 'productId'],
                  },
                },
                shippingAddress: { bsonType: 'string' },
                statusHistory: {
                  bsonType: 'array',
                  items: {
                    additionalProperties: false,
                    bsonType: 'object',
                    properties: { status: { bsonType: 'string' }, timestamp: { bsonType: 'date' } },
                    required: ['status', 'timestamp'],
                  },
                },
                type: { bsonType: 'string', enum: ['delivery', 'pickup'] },
                userId: { bsonType: 'objectId' },
              },
              required: ['_id', 'items', 'shippingAddress', 'statusHistory', 'type', 'userId'],
            },
          },
          validationLevel: 'strict',
          validationAction: 'error',
        },
        {
          id: 'validator.orders.update',
          label: 'Update validator on orders',
          operationClass: 'destructive',
        },
      ),
      collMod(
        'products',
        {
          validator: {
            $jsonSchema: {
              additionalProperties: false,
              bsonType: 'object',
              properties: {
                _id: { bsonType: 'objectId' },
                articleType: { bsonType: 'string' },
                brand: { bsonType: 'string' },
                code: { bsonType: 'string' },
                description: { bsonType: 'string' },
                embedding: { bsonType: 'array', items: { bsonType: 'double' } },
                image: {
                  additionalProperties: false,
                  bsonType: 'object',
                  properties: { url: { bsonType: 'string' } },
                  required: ['url'],
                },
                name: { bsonType: 'string' },
                price: {
                  additionalProperties: false,
                  bsonType: 'object',
                  properties: { amount: { bsonType: 'double' }, currency: { bsonType: 'string' } },
                  required: ['amount', 'currency'],
                },
                primaryCategory: { bsonType: 'string' },
                status: { bsonType: 'string', enum: ['active', 'discontinued', 'out-of-stock'] },
                subCategory: { bsonType: 'string' },
              },
              required: [
                '_id',
                'articleType',
                'brand',
                'code',
                'description',
                'image',
                'name',
                'price',
                'primaryCategory',
                'status',
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
