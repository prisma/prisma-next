import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { aggregateEventsByType, createEvent } from '../src/data/events';
import { getRandomProducts } from '../src/data/products';
import { setupTestDb } from './setup';

describe('aggregation pipelines', { timeout: timeouts.spinUpDbServer }, () => {
  const ctx = setupTestDb('aggregation_test');

  it('aggregates events by type for a user', async () => {
    const events = [
      { type: 'view-product', count: 3 },
      { type: 'add-to-cart', count: 2 },
      { type: 'search', count: 1 },
    ];

    for (const { type, count } of events) {
      for (let i = 0; i < count; i++) {
        await createEvent(ctx.db, {
          userId: 'test-user',
          sessionId: `sess-${i}`,
          type,
          timestamp: new Date(),
          metadata: {
            productId: null,
            subCategory: null,
            brand: null,
            query: null,
            exitMethod: null,
          },
        });
      }
    }

    const result = await aggregateEventsByType(ctx.db, 'test-user');
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ _id: 'view-product', count: 3 });
    expect(result[1]).toMatchObject({ _id: 'add-to-cart', count: 2 });
    expect(result[2]).toMatchObject({ _id: 'search', count: 1 });
  });

  it('samples random products', async () => {
    await ctx.db.orm.products.createAll(
      Array.from({ length: 10 }, (_, i) => ({
        name: `Product ${i}`,
        brand: 'TestBrand',
        code: `TB-${i}`,
        description: `Description ${i}`,
        masterCategory: 'Apparel',
        subCategory: 'Topwear',
        articleType: 'Shirts',
        price: { amount: 10 + i, currency: 'USD' },
        image: { url: `/img${i}.jpg` },
        embedding: null,
      })),
    );

    const sample = await getRandomProducts(ctx.db, 3);
    expect(sample).toHaveLength(3);
    for (const product of sample) {
      expect(product).toHaveProperty('name');
      expect(product).toHaveProperty('price');
    }
  });
});
