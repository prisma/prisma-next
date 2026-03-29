import { MongoParamRef, UpdateOneCommand } from '@prisma-next/mongo-core';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('updateOne integration', () => {
  const collectionName = 'update_test_users';

  it('updates a matching document', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(collectionName).insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);

      const plan = ctx.makePlan(
        new UpdateOneCommand(
          collectionName,
          { name: new MongoParamRef('Alice') },
          { $set: { age: new MongoParamRef(31) } },
        ),
      );
      const rows = await ctx.runtime.execute(plan);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ matchedCount: 1, modifiedCount: 1 });

      const doc = await db.collection(collectionName).findOne({ name: 'Alice' });
      expect(doc).toMatchObject({ name: 'Alice', age: 31 });
    });
  });
});
