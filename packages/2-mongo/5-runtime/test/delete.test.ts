import { DeleteOneCommand, MongoParamRef } from '@prisma-next/mongo-core';
import { describe, expect, it } from 'vitest';
import { getRuntime, makePlan } from './helpers';
import { getClient, getDbName } from './setup';

describe('deleteOne integration', () => {
  const collectionName = 'delete_test_users';

  beforeEach(async () => {
    const db = getClient().db(getDbName());
    const col = db.collection(collectionName);
    await col.deleteMany({});
    await col.insertMany([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]);
  });

  it('deletes a matching document', async () => {
    const rt = await getRuntime();
    const plan = makePlan(new DeleteOneCommand(collectionName, { name: new MongoParamRef('Bob') }));
    const rows = await rt.execute(plan);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ deletedCount: 1 });

    const db = getClient().db(getDbName());
    const remaining = await db.collection(collectionName).find({}).toArray();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ name: 'Alice' });
  });
});
