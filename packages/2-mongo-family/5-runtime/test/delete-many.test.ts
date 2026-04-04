import { DeleteManyCommand, MongoParamRef } from '@prisma-next/mongo-core';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('deleteMany integration', () => {
  const collectionName = 'delete_many_test';

  it('deletes multiple documents and returns count', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db
        .collection(collectionName)
        .insertMany([{ status: 'old' }, { status: 'old' }, { status: 'new' }]);

      const command = new DeleteManyCommand(collectionName, {
        status: new MongoParamRef('old'),
      });
      const rows = await ctx.runtime.executeCommand(command, ctx.stubMeta);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ deletedCount: 2 });
    });
  });
});
