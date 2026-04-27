/**
 * Database Seed Script
 *
 * Populates the Mongo PoC database with sample data spanning all the
 * collections the five Server Components read from: products, users,
 * orders (with user includes), and events (with polymorphic variants).
 *
 * Run with: pnpm seed
 *
 * Prerequisites:
 * - DB_URL environment variable set
 * - Contract emitted (run `pnpm emit`)
 *
 * The dataset mirrors `retail-store/src/seed.ts` in shape (same schema,
 * same realistic product catalog), trimmed to the fields the PoC's
 * Server Components actually render. Intentionally not feature-complete
 * (no vector embeddings, no invoices beyond one row) — the goal is just
 * enough data that each of the five cards has something to display.
 */
import { existsSync } from 'node:fs';
import { createMongoAdapter } from '@prisma-next/adapter-mongo';
import { MongoDriverImpl } from '@prisma-next/driver-mongo';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import { mongoOrm } from '@prisma-next/mongo-orm';
import { createMongoRuntime } from '@prisma-next/mongo-runtime';
import { MongoClient } from 'mongodb';
import type { Contract } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const productData = [
  {
    name: 'Classic Oxford Shirt',
    brand: 'Heritage',
    code: 'HER-OXF-001',
    description: 'Timeless button-down oxford shirt in crisp white cotton',
    masterCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Shirts',
    price: { amount: 79.99, currency: 'USD' },
  },
  {
    name: 'Linen Camp Collar Shirt',
    brand: 'Heritage',
    code: 'HER-LIN-002',
    description: 'Relaxed linen camp collar shirt for warm weather',
    masterCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Shirts',
    price: { amount: 89.99, currency: 'USD' },
  },
  {
    name: 'Merino Crew Sweater',
    brand: 'Heritage',
    code: 'HER-MER-003',
    description: 'Lightweight merino wool crew neck sweater',
    masterCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Sweaters',
    price: { amount: 119.99, currency: 'USD' },
  },
  {
    name: 'Graphic Tee - Mountain',
    brand: 'UrbanEdge',
    code: 'UE-TEE-010',
    description: 'Soft cotton graphic tee with mountain print',
    masterCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'T-Shirts',
    price: { amount: 34.99, currency: 'USD' },
  },
  {
    name: 'Performance Polo',
    brand: 'UrbanEdge',
    code: 'UE-POL-011',
    description: 'Moisture-wicking performance polo for active days',
    masterCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Shirts',
    price: { amount: 54.99, currency: 'USD' },
  },
  {
    name: 'Denim Jacket',
    brand: 'UrbanEdge',
    code: 'UE-DEN-012',
    description: 'Classic medium-wash denim jacket',
    masterCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Jackets',
    price: { amount: 99.99, currency: 'USD' },
  },
  {
    name: 'Slim Fit Chinos',
    brand: 'UrbanEdge',
    code: 'UE-CHI-042',
    description: 'Modern slim-fit chinos in navy with stretch comfort',
    masterCategory: 'Apparel',
    subCategory: 'Bottomwear',
    articleType: 'Trousers',
    price: { amount: 59.99, currency: 'USD' },
  },
  {
    name: 'Leather Crossbody Bag',
    brand: 'Craftsman',
    code: 'CRA-BAG-017',
    description: 'Hand-stitched leather crossbody bag with adjustable strap',
    masterCategory: 'Accessories',
    subCategory: 'Bags',
    articleType: 'Handbags',
    price: { amount: 149.99, currency: 'USD' },
  },
] as const;

async function main() {
  const uri = process.env['DB_URL'];
  if (!uri) {
    console.error('DB_URL is required. Set it in your environment or .env file.');
    process.exit(1);
  }
  const dbName = process.env['MONGODB_DB'] ?? 'rsc-poc-mongo';

  const { contract } = validateMongoContract<Contract>(contractJson);
  const client = new MongoClient(uri);
  await client.connect();

  try {
    // Drop so `pnpm seed` is idempotent across runs.
    await client.db(dbName).dropDatabase();

    const driver = MongoDriverImpl.fromDb(client.db(dbName));
    const adapter = createMongoAdapter();
    const runtime = createMongoRuntime({ adapter, driver, contract, targetId: 'mongo' });
    const orm = mongoOrm({ contract, executor: runtime });

    const products = await orm.products.createAll(
      productData.map((p) => ({
        ...p,
        image: { url: `/images/products/${p.code.toLowerCase()}.jpg` },
        embedding: null,
      })),
    );
    console.log(`Created ${products.length} products`);

    const alice = await orm.users.create({
      name: 'Alice Chen',
      email: 'alice@example.com',
      address: {
        streetAndNumber: '123 Main St',
        city: 'San Francisco',
        postalCode: '94102',
        country: 'US',
      },
    });

    const bob = await orm.users.create({
      name: 'Bob Kumar',
      email: 'bob@example.com',
      address: null,
    });
    console.log(`Created users: ${alice.email}, ${bob.email}`);

    const p0 = products[0];
    const p2 = products[7];
    if (!p0 || !p2) throw new Error('Failed to seed products');

    await orm.orders.create({
      userId: bob._id,
      items: [
        {
          productId: p2._id,
          name: p2.name,
          brand: p2.brand,
          image: { url: `/images/products/${p2.code.toLowerCase()}.jpg` },
          amount: 1,
          price: { amount: 149.99, currency: 'USD' },
        },
      ],
      shippingAddress: '456 Oak Ave, Portland, OR 97201',
      type: 'home',
      statusHistory: [{ status: 'placed', timestamp: new Date('2026-03-01T10:00:00Z') }],
    });

    await orm.orders.create({
      userId: alice._id,
      items: [
        {
          productId: p0._id,
          name: p0.name,
          brand: p0.brand,
          image: { url: `/images/products/${p0.code.toLowerCase()}.jpg` },
          amount: 2,
          price: { amount: 79.99, currency: 'USD' },
        },
      ],
      shippingAddress: '123 Main St, San Francisco, CA 94102',
      type: 'home',
      statusHistory: [{ status: 'placed', timestamp: new Date('2026-03-02T14:30:00Z') }],
    });
    console.log('Created 2 orders');

    await orm.events.variant('ViewProductEvent').create({
      userId: 'alice-session-1',
      sessionId: 'sess-001',
      timestamp: new Date('2026-03-01T09:00:00Z'),
      productId: p0._id,
      subCategory: 'Topwear',
      brand: 'Heritage',
      exitMethod: null,
    });

    await orm.events.variant('AddToCartEvent').create({
      userId: 'alice-session-1',
      sessionId: 'sess-001',
      timestamp: new Date('2026-03-01T09:05:00Z'),
      productId: p0._id,
      brand: 'Heritage',
    });

    await orm.events.variant('SearchEvent').create({
      userId: 'bob-session-1',
      sessionId: 'sess-002',
      timestamp: new Date('2026-03-01T09:30:00Z'),
      query: 'leather bag',
    });

    await orm.events.variant('SearchEvent').create({
      userId: 'alice-session-2',
      sessionId: 'sess-003',
      timestamp: new Date('2026-03-02T10:00:00Z'),
      query: 'oxford shirt',
    });

    console.log('Created 4 events (1 view, 1 add-to-cart, 2 searches)');
    console.log('Seed completed successfully!');

    await runtime.close();
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Error seeding database:', err);
  process.exit(1);
});
