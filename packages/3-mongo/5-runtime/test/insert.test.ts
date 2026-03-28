import { InsertOneCommand, MongoParamRef } from '@prisma-next/mongo-core';
import { describe, expect, it } from 'vitest';
import { getRuntime, makePlan } from './helpers';
import { getClient, getDbName } from './setup';

describe('insertOne integration', () => {
  const collectionName = 'insert_test_users';

  beforeEach(async () => {
    const db = getClient().db(getDbName());
    await db.collection(collectionName).deleteMany({});
  });

  it('inserts a document and returns insertedId', async () => {
    const rt = await getRuntime();
    const plan = makePlan(
      new InsertOneCommand(collectionName, {
        name: new MongoParamRef('Dave'),
        age: new MongoParamRef(28),
      }),
    );
    const rows = await rt.execute(plan);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty('insertedId');

    const db = getClient().db(getDbName());
    const docs = await db.collection(collectionName).find({}).toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ name: 'Dave', age: 28 });
  });
});
