import { FindCommand, MongoParamRef } from '@prisma-next/mongo-core';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('find integration', () => {
  const collectionName = 'find_test_users';

  it('finds all documents', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(collectionName).insertMany([
        { name: 'Alice', age: 30, active: true },
        { name: 'Bob', age: 25, active: false },
        { name: 'Charlie', age: 35, active: true },
      ]);

      const plan = ctx.makePlan(new FindCommand(collectionName));
      const rows = await ctx.runtime.execute(plan);
      expect(rows).toHaveLength(3);
    });
  });

  it('filters with param refs', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(collectionName).insertMany([
        { name: 'Alice', age: 30, active: true },
        { name: 'Bob', age: 25, active: false },
      ]);

      const plan = ctx.makePlan(
        new FindCommand(collectionName, { name: new MongoParamRef('Alice') }),
      );
      const rows = await ctx.runtime.execute(plan);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'Alice', age: 30 });
    });
  });

  it('respects projection', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(collectionName).insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
        { name: 'Charlie', age: 35 },
      ]);

      const plan = ctx.makePlan(
        new FindCommand(collectionName, undefined, { projection: { name: 1, _id: 0 } }),
      );
      const rows = await ctx.runtime.execute(plan);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(Object.keys(row as Record<string, unknown>)).toEqual(['name']);
      }
    });
  });

  it('respects limit and skip', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(collectionName).insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
        { name: 'Charlie', age: 35 },
      ]);

      const plan = ctx.makePlan(
        new FindCommand(collectionName, undefined, {
          sort: { name: 1 },
          limit: 2,
          skip: 1,
        }),
      );
      const rows = await ctx.runtime.execute(plan);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ name: 'Bob' });
      expect(rows[1]).toMatchObject({ name: 'Charlie' });
    });
  });
});
