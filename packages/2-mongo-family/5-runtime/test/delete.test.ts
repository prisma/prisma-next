import { DeleteOneCommand, MongoParamRef } from '@prisma-next/mongo-core';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('deleteOne integration', () => {
  const collectionName = 'delete_test_users';

  it('deletes a matching document', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(collectionName).insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);

      const plan = ctx.makePlan(
        new DeleteOneCommand(collectionName, { name: new MongoParamRef('Bob') }),
      );
      const rows = await ctx.runtime.execute(plan);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ deletedCount: 1 });

      const remaining = await db.collection(collectionName).find({}).toArray();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ name: 'Alice' });
    });
  });
});
