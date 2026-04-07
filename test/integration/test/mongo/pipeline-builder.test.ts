import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import { acc, fn, mongoPipeline } from '@prisma-next/mongo-pipeline-builder';
import {
  MongoAggFieldRef,
  MongoCountStage,
  MongoFieldFilter,
  MongoLimitStage,
  MongoMatchStage,
  type MongoQueryPlan,
  MongoSortStage,
} from '@prisma-next/mongo-query-ast';
import { describe, expect, it } from 'vitest';
import { describeWithMongoDB } from './setup';

// ---------------------------------------------------------------------------
// Contract fixture — Products + Orders, purpose-built for pipeline testing
// ---------------------------------------------------------------------------

type PipelineContract = MongoContract & {
  readonly models: {
    readonly Product: {
      readonly fields: {
        readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
        readonly name: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
        readonly category: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
        readonly price: { readonly codecId: 'mongo/double@1'; readonly nullable: false };
        readonly tags: { readonly codecId: 'mongo/array@1'; readonly nullable: false };
      };
      readonly relations: Record<string, never>;
      readonly storage: { readonly collection: 'products' };
    };
    readonly Order: {
      readonly fields: {
        readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
        readonly productName: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
        readonly quantity: { readonly codecId: 'mongo/double@1'; readonly nullable: false };
        readonly status: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
      };
      readonly relations: Record<string, never>;
      readonly storage: { readonly collection: 'orders' };
    };
  };
  readonly roots: { readonly products: 'Product'; readonly orders: 'Order' };
};

type TestCodecTypes = {
  readonly 'mongo/objectId@1': { readonly output: string };
  readonly 'mongo/string@1': { readonly output: string };
  readonly 'mongo/double@1': { readonly output: number };
  readonly 'mongo/array@1': { readonly output: unknown[] };
};

type TestTypeMaps = MongoTypeMaps<TestCodecTypes>;
type TContract = MongoContractWithTypeMaps<PipelineContract, TestTypeMaps>;

const contractJson = {
  target: 'mongo',
  targetFamily: 'mongo',
  roots: { products: 'Product', orders: 'Order' },
  models: {
    Product: {
      fields: {
        _id: { codecId: 'mongo/objectId@1', nullable: false },
        name: { codecId: 'mongo/string@1', nullable: false },
        category: { codecId: 'mongo/string@1', nullable: false },
        price: { codecId: 'mongo/double@1', nullable: false },
        tags: { codecId: 'mongo/array@1', nullable: false },
      },
      relations: {},
      storage: { collection: 'products' },
    },
    Order: {
      fields: {
        _id: { codecId: 'mongo/objectId@1', nullable: false },
        productName: { codecId: 'mongo/string@1', nullable: false },
        quantity: { codecId: 'mongo/double@1', nullable: false },
        status: { codecId: 'mongo/string@1', nullable: false },
      },
      relations: {},
      storage: { collection: 'orders' },
    },
  },
  storage: { storageHash: 'test-hash', collections: { products: {}, orders: {} } },
  capabilities: {},
  extensionPacks: {},
  profileHash: 'test-profile',
  meta: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pipeline = mongoPipeline<TContract>({ contractJson });

function products() {
  return pipeline.from('products');
}

function orders() {
  return pipeline.from('orders');
}

type Row = Record<string, unknown>;

const PRODUCTS = [
  { name: 'Laptop', category: 'electronics', price: 999, tags: ['tech', 'portable'] },
  { name: 'Phone', category: 'electronics', price: 699, tags: ['tech', 'mobile'] },
  { name: 'Desk', category: 'furniture', price: 250, tags: ['office'] },
  { name: 'Chair', category: 'furniture', price: 150, tags: ['office', 'ergonomic'] },
  { name: 'Notebook', category: 'stationery', price: 5, tags: ['paper'] },
];

const ORDERS = [
  { productName: 'Laptop', quantity: 2, status: 'shipped' },
  { productName: 'Laptop', quantity: 1, status: 'pending' },
  { productName: 'Phone', quantity: 3, status: 'shipped' },
  { productName: 'Desk', quantity: 1, status: 'delivered' },
  { productName: 'Chair', quantity: 4, status: 'shipped' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeWithMongoDB('Pipeline builder integration (mongoPipeline DSL)', (ctx) => {
  async function seed() {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('products').insertMany(PRODUCTS.map((p) => ({ ...p })));
    await db.collection('orders').insertMany(ORDERS.map((o) => ({ ...o })));
  }

  async function exec(plan: MongoQueryPlan): Promise<Row[]> {
    const rows = await ctx.runtime.execute(plan).toArray();
    return rows as Row[];
  }

  // ---------- Basic pipeline flow ----------

  describe('match + sort + limit + skip', () => {
    it('filters, sorts, and paginates', async () => {
      await seed();

      const plan = products()
        .match((f) => f.category.eq('electronics'))
        .sort({ price: -1 })
        .limit(1)
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ name: 'Laptop', price: 999 });
    });

    it('skips documents', async () => {
      await seed();

      const plan = products()
        .match((f) => f.category.eq('electronics'))
        .sort({ price: 1 })
        .skip(1)
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ name: 'Laptop' });
    });
  });

  // ---------- Aggregation ----------

  describe('group with accumulators', () => {
    it('groups by category and sums prices', async () => {
      await seed();

      const plan = products()
        .group((f) => ({
          _id: f.category,
          totalPrice: acc.sum(f.price),
          count: acc.count(),
        }))
        .sort({ _id: 1 })
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({ _id: 'electronics', totalPrice: 1698, count: 2 });
      expect(results[1]).toMatchObject({ _id: 'furniture', totalPrice: 400, count: 2 });
      expect(results[2]).toMatchObject({ _id: 'stationery', totalPrice: 5, count: 1 });
    });

    it('whole-collection grouping with _id: null', async () => {
      await seed();

      const plan = products()
        .group((_f) => ({
          _id: null,
          maxPrice: acc.max(_f.price),
          minPrice: acc.min(_f.price),
        }))
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ _id: null, maxPrice: 999, minPrice: 5 });
    });
  });

  // ---------- Computed fields ----------

  describe('addFields', () => {
    it('adds computed fields to documents', async () => {
      await seed();

      const plan = products()
        .match((f) => f.name.eq('Laptop'))
        .addFields((f) => ({
          discountedPrice: fn.multiply(f.price, fn.literal(0.9)),
        }))
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ name: 'Laptop' });
      expect((results[0] as Row)['discountedPrice']).toBeCloseTo(899.1);
    });
  });

  // ---------- Field selection ----------

  describe('project', () => {
    it('includes only specified fields', async () => {
      await seed();

      const plan = products()
        .match((f) => f.name.eq('Laptop'))
        .project('name', 'price')
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      const keys = Object.keys(results[0]!);
      expect(keys).toContain('name');
      expect(keys).toContain('price');
      expect(keys).not.toContain('category');
      expect(keys).not.toContain('tags');
    });

    it('computed projection with expressions', async () => {
      await seed();

      const plan = products()
        .match((f) => f.name.eq('Laptop'))
        .project((f) => ({
          name: 1 as const,
          upperCategory: fn.toUpper(f.category),
        }))
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ name: 'Laptop', upperCategory: 'ELECTRONICS' });
    });
  });

  // ---------- Count ----------

  describe('count', () => {
    it('counts matching documents', async () => {
      await seed();

      const plan = products()
        .match((f) => f.category.eq('electronics'))
        .count('total')
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ total: 2 });
    });
  });

  // ---------- Array flattening ----------

  describe('unwind', () => {
    it('flattens array field into separate documents', async () => {
      await seed();

      const plan = products()
        .match((f) => f.name.eq('Chair'))
        .unwind('tags')
        .sort({ tags: 1 })
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ name: 'Chair', tags: 'ergonomic' });
      expect(results[1]).toMatchObject({ name: 'Chair', tags: 'office' });
    });
  });

  // ---------- Cross-collection join ----------

  describe('lookup', () => {
    it('joins orders with products by name', async () => {
      await seed();

      const plan = orders()
        .match((f) => f.productName.eq('Laptop'))
        .lookup({
          from: 'products',
          localField: 'productName',
          foreignField: 'name',
          as: 'productDetails',
        })
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(2);
      for (const row of results) {
        const details = (row as Row)['productDetails'] as Row[];
        expect(details).toHaveLength(1);
        expect(details[0]).toMatchObject({ name: 'Laptop', category: 'electronics' });
      }
    });
  });

  // ---------- Multi-pipeline ----------

  describe('facet', () => {
    it('runs multiple sub-pipelines in parallel', async () => {
      await seed();

      const plan = products()
        .facet({
          totalCount: [new MongoCountStage('count')],
          cheapest: [new MongoSortStage({ price: 1 }), new MongoLimitStage(2)],
          byCategory: [
            new MongoMatchStage(MongoFieldFilter.eq('category', 'electronics')),
            new MongoCountStage('count'),
          ],
        })
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      const facets = results[0] as Record<string, Row[]>;
      expect(facets['totalCount']).toEqual([{ count: 5 }]);
      expect(facets['cheapest']).toHaveLength(2);
      expect(facets['cheapest']![0]).toMatchObject({ name: 'Notebook', price: 5 });
      expect(facets['byCategory']).toEqual([{ count: 2 }]);
    });
  });

  // ---------- Bucketing ----------

  describe('bucket', () => {
    it('groups documents into price ranges', async () => {
      await seed();

      const plan = products()
        .bucket({
          groupBy: MongoAggFieldRef.of('price'),
          boundaries: [0, 100, 500, 1000],
          default_: 'Other',
        })
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(3);
      const buckets = results.map((r) => ({ _id: (r as Row)['_id'], count: (r as Row)['count'] }));
      expect(buckets).toContainEqual({ _id: 0, count: 1 });
      expect(buckets).toContainEqual({ _id: 100, count: 2 });
      expect(buckets).toContainEqual({ _id: 500, count: 2 });
    });
  });

  // ---------- Union ----------

  describe('unionWith', () => {
    it('combines documents from two collections', async () => {
      await seed();

      const plan = products()
        .project('name')
        .unionWith('orders', [new MongoMatchStage(MongoFieldFilter.eq('status', 'delivered'))])
        .build();

      const results = await exec(plan);
      // 5 products + 1 delivered order
      expect(results).toHaveLength(6);
    });
  });

  // ---------- Frequency ----------

  describe('sortByCount', () => {
    it('counts and sorts by category frequency', async () => {
      await seed();

      const plan = products()
        .sortByCount((f) => f.category)
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(3);
      // First two have count=2 (order among ties is non-deterministic)
      const topTwo = results
        .slice(0, 2)
        .map((r) => r['_id'])
        .sort();
      expect(topTwo).toEqual(['electronics', 'furniture']);
      expect(results[2]).toMatchObject({ _id: 'stationery', count: 1 });
    });
  });

  // ---------- Random sampling ----------

  describe('sample', () => {
    it('returns requested number of random documents', async () => {
      await seed();

      const plan = products().sample(3).build();
      const results = await exec(plan);
      expect(results).toHaveLength(3);
    });
  });

  // ---------- Output stages ----------

  describe('out', () => {
    it('writes pipeline results to a new collection', async () => {
      await seed();

      const plan = products()
        .match((f) => f.category.eq('electronics'))
        .out('electronics')
        .build();

      await exec(plan);

      const db = ctx.client.db(ctx.dbName);
      const docs = await db.collection('electronics').find().toArray();
      expect(docs).toHaveLength(2);
      const names = docs.map((d) => d['name']).sort();
      expect(names).toEqual(['Laptop', 'Phone']);
    });
  });

  describe('merge', () => {
    it('merges pipeline results into target collection', async () => {
      await seed();

      const db = ctx.client.db(ctx.dbName);
      await db.collection('summary').insertOne({ _id: 'placeholder' as never, source: 'old' });

      const plan = products()
        .group((f) => ({
          _id: f.category,
          total: acc.sum(f.price),
        }))
        .merge({ into: 'summary', whenNotMatched: 'insert' })
        .build();

      await exec(plan);

      const docs = await db.collection('summary').find().toArray();
      expect(docs.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ---------- Complex multi-stage pipeline ----------

  describe('complex pipeline', () => {
    it('chains match → group → sort → limit end-to-end', async () => {
      await seed();

      const plan = orders()
        .match((f) => f.status.eq('shipped'))
        .group((f) => ({
          _id: f.productName,
          totalQty: acc.sum(f.quantity),
        }))
        .sort({ totalQty: -1 })
        .limit(2)
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ _id: 'Chair', totalQty: 4 });
      expect(results[1]).toMatchObject({ _id: 'Phone', totalQty: 3 });
    });

    it('lookup → pipe(match): orders enriched with product info', async () => {
      await seed();

      const plan = orders()
        .lookup({
          from: 'products',
          localField: 'productName',
          foreignField: 'name',
          as: 'product',
        })
        .pipe(new MongoMatchStage(MongoFieldFilter.eq('status', 'shipped')))
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(3);
      for (const row of results) {
        const product = ((row as Row)['product'] as Row[])[0];
        expect(product).toBeDefined();
        expect(product).toHaveProperty('category');
      }
    });
  });
});
