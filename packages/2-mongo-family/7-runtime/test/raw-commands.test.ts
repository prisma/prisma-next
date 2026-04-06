import type { PlanMeta } from '@prisma-next/contract/types';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast';
import {
  RawAggregateCommand,
  RawDeleteManyCommand,
  RawFindOneAndUpdateCommand,
  RawInsertManyCommand,
  RawInsertOneCommand,
  RawUpdateManyCommand,
} from '@prisma-next/mongo-query-ast';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

const rawMeta: PlanMeta = {
  target: 'mongo',
  storageHash: 'test-hash',
  lane: 'mongo-raw',
  paramDescriptors: [],
};

function rawPlan(collection: string, command: MongoQueryPlan['command']): MongoQueryPlan {
  return { collection, command, meta: rawMeta };
}

describe('raw command integration', () => {
  const col = 'raw_test_items';

  it('aggregate: $group + $sort pipeline', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(col).insertMany([
        { department: 'eng', amount: 100 },
        { department: 'eng', amount: 200 },
        { department: 'sales', amount: 150 },
      ]);

      const command = new RawAggregateCommand(col, [
        { $group: { _id: '$department', total: { $sum: '$amount' } } },
        { $sort: { _id: 1 } },
      ]);
      const rows = await ctx.runtime.execute(rawPlan(col, command));
      expect(rows).toHaveLength(2);

      const typed = rows as Array<{ _id: string; total: number }>;
      expect(typed[0]).toMatchObject({ _id: 'eng', total: 300 });
      expect(typed[1]).toMatchObject({ _id: 'sales', total: 150 });
    });
  });

  it('insertOne + read-back via aggregate $match', async () => {
    await withMongod(async (ctx) => {
      const insertCmd = new RawInsertOneCommand(col, {
        name: 'Alice',
        email: 'alice@example.com',
      });
      const insertRows = await ctx.runtime.execute(rawPlan(col, insertCmd));
      expect(insertRows).toHaveLength(1);
      expect(insertRows[0]).toHaveProperty('insertedId');

      const readCmd = new RawAggregateCommand(col, [{ $match: { name: 'Alice' } }]);
      const readRows = await ctx.runtime.execute(rawPlan(col, readCmd));
      expect(readRows).toHaveLength(1);
      expect((readRows[0] as Record<string, unknown>)['email']).toBe('alice@example.com');
    });
  });

  it('insertMany + updateMany + verify modified documents', async () => {
    await withMongod(async (ctx) => {
      const insertCmd = new RawInsertManyCommand(col, [
        { name: 'Bob', status: 'active' },
        { name: 'Carol', status: 'active' },
        { name: 'Dave', status: 'inactive' },
      ]);
      await ctx.runtime.execute(rawPlan(col, insertCmd));

      const updateCmd = new RawUpdateManyCommand(
        col,
        { status: 'active' },
        { $set: { status: 'archived' } },
      );
      const updateRows = await ctx.runtime.execute(rawPlan(col, updateCmd));
      expect(updateRows).toHaveLength(1);
      expect(updateRows[0]).toMatchObject({ matchedCount: 2, modifiedCount: 2 });

      const db = ctx.client.db(ctx.dbName);
      const archived = await db.collection(col).find({ status: 'archived' }).toArray();
      expect(archived).toHaveLength(2);
    });
  });

  it('deleteMany + verify documents removed', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(col).insertMany([
        { name: 'X', temp: true },
        { name: 'Y', temp: true },
        { name: 'Z', temp: false },
      ]);

      const deleteCmd = new RawDeleteManyCommand(col, { temp: true });
      const deleteRows = await ctx.runtime.execute(rawPlan(col, deleteCmd));
      expect(deleteRows).toHaveLength(1);
      expect(deleteRows[0]).toMatchObject({ deletedCount: 2 });

      const remaining = await db.collection(col).find({}).toArray();
      expect(remaining).toHaveLength(1);
      expect((remaining[0] as Record<string, unknown>)['name']).toBe('Z');
    });
  });

  it('findOneAndUpdate with upsert', async () => {
    await withMongod(async (ctx) => {
      const upsertCmd = new RawFindOneAndUpdateCommand(
        col,
        { _id: 'pageViews' },
        { $inc: { count: 1 }, $setOnInsert: { _id: 'pageViews' } },
        true,
      );
      const rows = await ctx.runtime.execute(rawPlan(col, upsertCmd));
      expect(rows).toHaveLength(1);
      expect((rows[0] as Record<string, unknown>)['count']).toBe(1);

      const rows2 = await ctx.runtime.execute(rawPlan(col, upsertCmd));
      expect(rows2).toHaveLength(1);
      expect((rows2[0] as Record<string, unknown>)['count']).toBe(2);
    });
  });

  it('pipeline-style update (updateMany with array update)', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(col).insertMany([
        { firstName: 'Alice', lastName: 'Smith' },
        { firstName: 'Bob', lastName: 'Jones' },
      ]);

      const updateCmd = new RawUpdateManyCommand(col, { firstName: { $exists: true } }, [
        { $set: { fullName: { $concat: ['$firstName', ' ', '$lastName'] } } },
      ]);
      const updateRows = await ctx.runtime.execute(rawPlan(col, updateCmd));
      expect(updateRows).toHaveLength(1);
      expect(updateRows[0]).toMatchObject({ matchedCount: 2, modifiedCount: 2 });

      const docs = await db.collection(col).find({}).sort({ firstName: 1 }).toArray();
      expect(docs[0]).toMatchObject({ fullName: 'Alice Smith' });
      expect(docs[1]).toMatchObject({ fullName: 'Bob Jones' });
    });
  });
});
