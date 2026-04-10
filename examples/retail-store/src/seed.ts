import type { Db } from './db';

export interface SeedResult {
  demoUserId: string;
}

export async function seed(db: Db): Promise<SeedResult> {
  const products = await db.orm.products.createAll([
    {
      name: 'Classic Oxford Shirt',
      brand: 'Heritage',
      code: 'HER-OXF-001',
      description: 'A timeless button-down oxford shirt in crisp white cotton',
      masterCategory: 'Apparel',
      subCategory: 'Topwear',
      articleType: 'Shirts',
      price: { amount: 79.99, currency: 'USD' },
      image: { url: '/images/products/classic-oxford.jpg' },
      embedding: null,
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
      image: { url: '/images/products/slim-chinos.jpg' },
      embedding: null,
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
      image: { url: '/images/products/leather-crossbody.jpg' },
      embedding: null,
    },
  ]);

  const product0 = products[0];
  const product1 = products[1];
  const product2 = products[2];
  if (!product0 || !product1 || !product2) throw new Error('Failed to seed products');

  const users = await db.orm.users.createAll([
    {
      name: 'Alice Chen',
      email: 'alice@example.com',
      address: {
        streetAndNumber: '123 Main St',
        city: 'San Francisco',
        postalCode: '94102',
        country: 'US',
      },
    },
    {
      name: 'Bob Kumar',
      email: 'bob@example.com',
      address: null,
    },
  ]);

  const alice = users[0];
  const bob = users[1];
  if (!alice || !bob) throw new Error('Failed to seed users');

  await db.orm.carts.create({
    userId: alice._id as string,
    items: [
      {
        productId: product0._id as string,
        name: product0.name as string,
        brand: product0.brand as string,
        amount: 1,
        price: { amount: 79.99, currency: 'USD' },
        image: { url: '/images/products/classic-oxford.jpg' },
      },
      {
        productId: product1._id as string,
        name: product1.name as string,
        brand: product1.brand as string,
        amount: 2,
        price: { amount: 59.99, currency: 'USD' },
        image: { url: '/images/products/slim-chinos.jpg' },
      },
    ],
  });

  const order = await db.orm.orders.create({
    userId: bob._id as string,
    items: [
      {
        productId: product2._id as string,
        name: product2.name as string,
        brand: product2.brand as string,
        amount: 1,
        price: { amount: 149.99, currency: 'USD' },
        image: { url: '/images/products/leather-crossbody.jpg' },
      },
    ],
    shippingAddress: '456 Oak Ave, Portland, OR 97201',
    type: 'home',
    statusHistory: [{ status: 'placed', timestamp: new Date('2026-03-01T10:00:00Z') }],
  });

  await db.orm.locations.createAll([
    {
      name: 'Downtown Flagship',
      streetAndNumber: '100 Market St',
      city: 'San Francisco',
      postalCode: '94105',
      country: 'US',
    },
    {
      name: 'Portland Store',
      streetAndNumber: '200 NW 23rd Ave',
      city: 'Portland',
      postalCode: '97210',
      country: 'US',
    },
  ]);

  await db.orm.invoices.create({
    orderId: order._id as string,
    items: [
      {
        name: 'Leather Crossbody Bag',
        amount: 1,
        unitPrice: 149.99,
        lineTotal: 149.99,
      },
    ],
    subtotal: 149.99,
    tax: 12.75,
    total: 162.74,
    issuedAt: new Date('2026-03-01T10:05:00Z'),
  });

  await db.orm.events.createAll([
    {
      userId: 'alice-session-1',
      sessionId: 'sess-001',
      type: 'view-product',
      timestamp: new Date('2026-03-01T09:00:00Z'),
      metadata: {
        productId: product0._id as string,
        subCategory: 'Topwear',
        brand: 'Heritage',
        query: null,
        exitMethod: null,
      },
    },
    {
      userId: 'alice-session-1',
      sessionId: 'sess-001',
      type: 'add-to-cart',
      timestamp: new Date('2026-03-01T09:05:00Z'),
      metadata: {
        productId: product0._id as string,
        subCategory: 'Topwear',
        brand: 'Heritage',
        query: null,
        exitMethod: null,
      },
    },
    {
      userId: 'bob-session-1',
      sessionId: 'sess-002',
      type: 'search',
      timestamp: new Date('2026-03-01T09:30:00Z'),
      metadata: {
        productId: null,
        subCategory: null,
        brand: null,
        query: 'leather bag',
        exitMethod: null,
      },
    },
  ]);

  return { demoUserId: String(alice._id) };
}
