import { MongoParamRef, UpdateOneCommand } from '@prisma-next/mongo-core';
import { describe, expect, it } from 'vitest';
import { getRuntime, makePlan } from './helpers';
import { getClient, getDbName } from './setup';

describe('updateOne integration', () => {
  const collectionName = 'update_test_users';

  beforeEach(async () => {
    const db = getClient().db(getDbName());
    const col = db.collection(collectionName);
    await col.deleteMany({});
    await col.insertMany([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]);
  });

  it('updates a matching document', async () => {
    const rt = await getRuntime();
    const plan = makePlan(
      new UpdateOneCommand(
        collectionName,
        { name: new MongoParamRef('Alice') },
        { $set: { age: new MongoParamRef(31) } },
      ),
    );
    const rows = await rt.execute(plan);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ matchedCount: 1, modifiedCount: 1 });

    const db = getClient().db(getDbName());
    const doc = await db.collection(collectionName).findOne({ name: 'Alice' });
    expect(doc).toMatchObject({ name: 'Alice', age: 31 });
  });
});
