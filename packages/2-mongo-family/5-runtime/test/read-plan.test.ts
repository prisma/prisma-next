import { MongoFieldFilter, MongoMatchStage } from '@prisma-next/mongo-query-ast';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('execute (read plan)', () => {
  const collectionName = 'read_plan_test';

  it('executes a read plan and returns matching rows', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(collectionName).insertMany([
        { name: 'Alice', role: 'admin' },
        { name: 'Bob', role: 'user' },
        { name: 'Carol', role: 'admin' },
      ]);

      const plan = {
        collection: collectionName,
        stages: [new MongoMatchStage(MongoFieldFilter.eq('role', 'admin'))],
        meta: ctx.stubMeta,
      };
      const rows = await ctx.runtime.execute<{ name: string; role: string }>(plan);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.name).sort()).toEqual(['Alice', 'Carol']);
    });
  });
});
