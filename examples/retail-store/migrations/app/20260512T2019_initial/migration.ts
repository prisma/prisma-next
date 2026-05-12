#!/usr/bin/env -S node
import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { Migration } from '@prisma-next/family-mongo/migration';
import { createCollection, createIndex } from '@prisma-next/target-mongo/migration';

class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:4407077380e2331b356697c35153192b3bdafadb432f0d64b081d24e8af3e55a',
    };
  }

  override get operations() {
    return [
      createCollection('carts', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'objectId' },
              items: {
                bsonType: 'array',
                items: {
                  bsonType: 'object',
                  properties: {
                    amount: { bsonType: 'int' },
                    brand: { bsonType: 'string' },
                    image: {
                      bsonType: 'object',
                      properties: { url: { bsonType: 'string' } },
                      required: ['url'],
                    },
                    name: { bsonType: 'string' },
                    price: {
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
              userId: { bsonType: 'objectId' },
            },
            required: ['_id', 'items', 'userId'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('events', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            oneOf: [
              {
                properties: {
                  brand: { bsonType: 'string' },
                  exitMethod: { bsonType: ['null', 'string'] },
                  productId: { bsonType: 'string' },
                  subCategory: { bsonType: 'string' },
                  type: { enum: ['view-product'] },
                },
                required: ['brand', 'productId', 'subCategory', 'type'],
              },
              {
                properties: { query: { bsonType: 'string' }, type: { enum: ['search'] } },
                required: ['query', 'type'],
              },
              {
                properties: {
                  brand: { bsonType: 'string' },
                  productId: { bsonType: 'string' },
                  type: { enum: ['add-to-cart'] },
                },
                required: ['brand', 'productId', 'type'],
              },
            ],
            properties: {
              _id: { bsonType: 'objectId' },
              sessionId: { bsonType: 'string' },
              timestamp: { bsonType: 'date' },
              type: { bsonType: 'string' },
              userId: { bsonType: 'string' },
            },
            required: ['_id', 'sessionId', 'timestamp', 'type', 'userId'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('invoices', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'objectId' },
              issuedAt: { bsonType: 'date' },
              items: {
                bsonType: 'array',
                items: {
                  bsonType: 'object',
                  properties: {
                    amount: { bsonType: 'int' },
                    lineTotal: { bsonType: 'double' },
                    name: { bsonType: 'string' },
                    unitPrice: { bsonType: 'double' },
                  },
                  required: ['amount', 'lineTotal', 'name', 'unitPrice'],
                },
              },
              orderId: { bsonType: 'objectId' },
              subtotal: { bsonType: 'double' },
              tax: { bsonType: 'double' },
              total: { bsonType: 'double' },
            },
            required: ['_id', 'issuedAt', 'items', 'orderId', 'subtotal', 'tax', 'total'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('locations', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'objectId' },
              city: { bsonType: 'string' },
              country: { bsonType: 'string' },
              name: { bsonType: 'string' },
              postalCode: { bsonType: 'string' },
              streetAndNumber: { bsonType: 'string' },
            },
            required: ['_id', 'city', 'country', 'name', 'postalCode', 'streetAndNumber'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('orders', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'objectId' },
              items: {
                bsonType: 'array',
                items: {
                  bsonType: 'object',
                  properties: {
                    amount: { bsonType: 'int' },
                    brand: { bsonType: 'string' },
                    image: {
                      bsonType: 'object',
                      properties: { url: { bsonType: 'string' } },
                      required: ['url'],
                    },
                    name: { bsonType: 'string' },
                    price: {
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
                  bsonType: 'object',
                  properties: { status: { bsonType: 'string' }, timestamp: { bsonType: 'date' } },
                  required: ['status', 'timestamp'],
                },
              },
              type: { bsonType: 'string' },
              userId: { bsonType: 'objectId' },
            },
            required: ['_id', 'items', 'shippingAddress', 'statusHistory', 'type', 'userId'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('products', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'objectId' },
              articleType: { bsonType: 'string' },
              brand: { bsonType: 'string' },
              code: { bsonType: 'string' },
              description: { bsonType: 'string' },
              embedding: { bsonType: 'array', items: { bsonType: 'double' } },
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
              status: { bsonType: 'string' },
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
              'status',
              'subCategory',
            ],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('users', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'objectId' },
              address: {
                oneOf: [
                  { bsonType: 'null' },
                  {
                    bsonType: 'object',
                    properties: {
                      city: { bsonType: 'string' },
                      country: { bsonType: 'string' },
                      postalCode: { bsonType: 'string' },
                      streetAndNumber: { bsonType: 'string' },
                    },
                    required: ['city', 'country', 'postalCode', 'streetAndNumber'],
                  },
                ],
              },
              email: { bsonType: 'string' },
              name: { bsonType: 'string' },
            },
            required: ['_id', 'email', 'name'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createIndex('carts', [{ direction: 1, field: 'userId' }], { unique: true }),
      createIndex(
        'events',
        [
          { direction: 1, field: 'userId' },
          { direction: -1, field: 'timestamp' },
        ],
        {},
      ),
      createIndex('events', [{ direction: 1, field: 'timestamp' }], {
        expireAfterSeconds: 7776000,
      }),
      createIndex('invoices', [{ direction: 1, field: 'orderId' }], {}),
      createIndex('invoices', [{ direction: -1, field: 'issuedAt' }], { sparse: true }),
      createIndex(
        'locations',
        [
          { direction: 1, field: 'city' },
          { direction: 1, field: 'country' },
        ],
        { collation: { locale: 'en', strength: 2 } },
      ),
      createIndex('orders', [{ direction: 1, field: 'userId' }], {}),
      createIndex(
        'products',
        [
          { direction: 'text', field: 'name' },
          { direction: 'text', field: 'description' },
        ],
        { weights: { description: 1, name: 10 } },
      ),
      createIndex(
        'products',
        [
          { direction: 1, field: 'brand' },
          { direction: 1, field: 'subCategory' },
        ],
        {},
      ),
      createIndex('products', [{ direction: 'hashed', field: 'code' }], {}),
      createIndex('users', [{ direction: 1, field: 'email' }], { unique: true }),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
