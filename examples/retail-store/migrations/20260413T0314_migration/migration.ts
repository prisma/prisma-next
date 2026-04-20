import { Migration } from '@prisma-next/family-mongo/migration';
import { createCollection, createIndex } from '@prisma-next/target-mongo/migration';

class InitialMigration extends Migration {
  override describe() {
    return {
      from: 'sha256:empty',
      to: 'sha256:e5cfc21670435e53a4af14a665d61d8ba716d5e2e67b63c1443affdcad86985d',
    };
  }

  override get operations() {
    return [
      createCollection('addToCartEvent', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            properties: {
              brand: { bsonType: 'string' },
              productId: { bsonType: 'string' },
            },
            required: ['brand', 'productId'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),

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
                      properties: { currency: { bsonType: 'string' } },
                      required: ['currency'],
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
                    name: { bsonType: 'string' },
                  },
                  required: ['amount', 'name'],
                },
              },
              orderId: { bsonType: 'objectId' },
            },
            required: ['_id', 'issuedAt', 'items', 'orderId'],
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
                      properties: { currency: { bsonType: 'string' } },
                      required: ['currency'],
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
                  properties: {
                    status: { bsonType: 'string' },
                    timestamp: { bsonType: 'date' },
                  },
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
              image: {
                bsonType: 'object',
                properties: { url: { bsonType: 'string' } },
                required: ['url'],
              },
              masterCategory: { bsonType: 'string' },
              name: { bsonType: 'string' },
              price: {
                bsonType: 'object',
                properties: { currency: { bsonType: 'string' } },
                required: ['currency'],
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
      }),

      createCollection('searchEvent', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            properties: {
              query: { bsonType: 'string' },
            },
            required: ['query'],
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

      createCollection('viewProductEvent', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            properties: {
              brand: { bsonType: 'string' },
              exitMethod: { bsonType: ['null', 'string'] },
              productId: { bsonType: 'string' },
              subCategory: { bsonType: 'string' },
            },
            required: ['brand', 'productId', 'subCategory'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),

      createIndex('carts', [{ field: 'userId', direction: 1 }], { unique: true }),
      createIndex('events', [
        { field: 'userId', direction: 1 },
        { field: 'timestamp', direction: -1 },
      ]),
      createIndex('events', [{ field: 'timestamp', direction: 1 }], {
        expireAfterSeconds: 7776000,
      }),
      createIndex('invoices', [{ field: 'orderId', direction: 1 }]),
      createIndex('invoices', [{ field: 'issuedAt', direction: -1 }], { sparse: true }),
      createIndex(
        'locations',
        [
          { field: 'city', direction: 1 },
          { field: 'country', direction: 1 },
        ],
        {
          collation: { locale: 'en', strength: 2 },
        },
      ),
      createIndex('orders', [{ field: 'userId', direction: 1 }]),
      createIndex(
        'products',
        [
          { field: 'name', direction: 'text' },
          { field: 'description', direction: 'text' },
        ],
        {
          weights: { description: 1, name: 10 },
        },
      ),
      createIndex('products', [
        { field: 'brand', direction: 1 },
        { field: 'subCategory', direction: 1 },
      ]),
      createIndex('products', [{ field: 'code', direction: 'hashed' }]),
      createIndex('users', [{ field: 'email', direction: 1 }], { unique: true }),
    ];
  }
}

export default InitialMigration;
Migration.run(import.meta.url, InitialMigration);
