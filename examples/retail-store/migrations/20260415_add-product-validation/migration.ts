import { Migration } from '@prisma-next/family-mongo/migration';
import { createIndex, setValidation } from '@prisma-next/target-mongo/migration';

export default class extends Migration {
  override describe() {
    return {
      from: 'sha256:e5cfc21670435e53a4af14a665d61d8ba716d5e2e67b63c1443affdcad86985d',
      to: 'sha256:e5cfc21670435e53a4af14a665d61d8ba716d5e2e67b63c1443affdcad86985d',
      labels: ['add-product-validation'],
    };
  }

  override plan() {
    return [
      setValidation(
        'products',
        {
          bsonType: 'object',
          required: ['name', 'price', 'category'],
          properties: {
            name: { bsonType: 'string' },
            price: { bsonType: 'number', minimum: 0 },
            category: { bsonType: 'string' },
          },
        },
        { validationLevel: 'moderate', validationAction: 'warn' },
      ),
      createIndex('products', [
        { field: 'category', direction: 1 },
        { field: 'price', direction: 1 },
      ]),
    ];
  }
}

Migration.run(import.meta.url);
