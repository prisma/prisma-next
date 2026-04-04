import { createMongoAdapter } from '@prisma-next/adapter-mongo';
import { createMongoDriver } from '@prisma-next/driver-mongo';
import { validateMongoContract } from '@prisma-next/mongo-core';
import { mongoOrm } from '@prisma-next/mongo-orm';
import { MongoFieldFilter } from '@prisma-next/mongo-query-ast';
import { createMongoRuntime, type MongoRuntime } from '@prisma-next/mongo-runtime';
import { timeouts } from '@prisma-next/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from '../src/contract';
import contractJson from '../src/contract.json' with { type: 'json' };

const { contract } = validateMongoContract<Contract>(contractJson);

describe('CRUD lifecycle', { timeout: timeouts.spinUpDbServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let runtime: MongoRuntime;
  const dbName = 'crud_lifecycle_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();

    const adapter = createMongoAdapter();
    const driver = await createMongoDriver(replSet.getUri(), dbName);
    runtime = createMongoRuntime({ adapter, driver });
  }, timeouts.spinUpDbServer);

  beforeEach(async () => {
    await client.db(dbName).dropDatabase();
  });

  afterAll(async () => {
    await Promise.allSettled([runtime?.close(), client?.close(), replSet?.stop()]);
  }, timeouts.spinUpDbServer);

  it('create → read → update → read → delete → read', async () => {
    const orm = mongoOrm({ contract, executor: runtime });

    const alice = await orm.users.create({
      name: 'Alice',
      email: 'alice@example.com',
      bio: 'Writer',
    });

    expect(alice._id).toBeDefined();
    expect(alice.name).toBe('Alice');
    expect(alice.email).toBe('alice@example.com');

    const allUsers = await orm.users.all();
    expect(allUsers).toHaveLength(1);
    expect(allUsers[0]).toMatchObject({ name: 'Alice', email: 'alice@example.com' });

    const updated = await orm.users
      .where(MongoFieldFilter.eq('name', 'Alice'))
      .update({ name: 'Alice Updated', bio: 'Editor' });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Alice Updated');

    const afterUpdate = await orm.users.all();
    expect(afterUpdate).toHaveLength(1);
    expect(afterUpdate[0]).toMatchObject({ name: 'Alice Updated', bio: 'Editor' });

    const deleted = await orm.users.where(MongoFieldFilter.eq('name', 'Alice Updated')).delete();

    expect(deleted).not.toBeNull();
    expect(deleted!.name).toBe('Alice Updated');

    const afterDelete = await orm.users.all();
    expect(afterDelete).toHaveLength(0);
  });

  it('createAll → read → updateAll → read → deleteAll → read', async () => {
    const orm = mongoOrm({ contract, executor: runtime });

    const created = await orm.users.createAll([
      { name: 'Alice', email: 'alice@example.com', bio: null },
      { name: 'Bob', email: 'bob@example.com', bio: null },
      { name: 'Carol', email: 'carol@example.com', bio: null },
    ]);

    expect(created).toHaveLength(3);
    const names = created.map((u) => u.name).sort();
    expect(names).toEqual(['Alice', 'Bob', 'Carol']);

    const allUsers = await orm.users.all();
    expect(allUsers).toHaveLength(3);

    const updatedRows = await orm.users
      .where(MongoFieldFilter.in('name', ['Alice', 'Bob']))
      .updateAll({ bio: 'Updated bio' });

    expect(updatedRows).toHaveLength(2);
    for (const row of updatedRows) {
      expect(row.bio).toBe('Updated bio');
    }

    const carol = await orm.users.where(MongoFieldFilter.eq('name', 'Carol')).first();
    expect(carol).not.toBeNull();
    expect(carol!.bio).toBeNull();

    const deletedRows = await orm.users
      .where(MongoFieldFilter.in('name', ['Alice', 'Bob']))
      .deleteAll();

    expect(deletedRows).toHaveLength(2);

    const remaining = await orm.users.all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ name: 'Carol' });
  });

  it('createCount returns inserted count', async () => {
    const orm = mongoOrm({ contract, executor: runtime });

    const count = await orm.users.createCount([
      { name: 'Alice', email: 'alice@example.com', bio: null },
      { name: 'Bob', email: 'bob@example.com', bio: null },
    ]);

    expect(count).toBe(2);

    const allUsers = await orm.users.all();
    expect(allUsers).toHaveLength(2);
  });

  it('updateCount returns modified count', async () => {
    const orm = mongoOrm({ contract, executor: runtime });

    await orm.users.createAll([
      { name: 'Alice', email: 'alice@example.com', bio: null },
      { name: 'Bob', email: 'bob@example.com', bio: null },
      { name: 'Carol', email: 'carol@example.com', bio: 'existing' },
    ]);

    const count = await orm.users
      .where(MongoFieldFilter.eq('bio', null))
      .updateCount({ bio: 'filled' });

    expect(count).toBe(2);
  });

  it('deleteCount returns deleted count', async () => {
    const orm = mongoOrm({ contract, executor: runtime });

    await orm.users.createAll([
      { name: 'Alice', email: 'alice@example.com', bio: null },
      { name: 'Bob', email: 'bob@example.com', bio: null },
      { name: 'Carol', email: 'carol@example.com', bio: 'keep' },
    ]);

    const count = await orm.users.where(MongoFieldFilter.eq('bio', null)).deleteCount();

    expect(count).toBe(2);

    const remaining = await orm.users.all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ name: 'Carol' });
  });

  it('upsert inserts when no match', async () => {
    const orm = mongoOrm({ contract, executor: runtime });

    const result = await orm.users.where(MongoFieldFilter.eq('email', 'new@example.com')).upsert({
      create: { name: 'New User', email: 'new@example.com', bio: 'New bio' },
      update: { name: 'Updated Name' },
    });

    expect(result).toBeDefined();
    expect(result._id).toBeDefined();

    const allUsers = await orm.users.all();
    expect(allUsers).toHaveLength(1);
    // $set always applies on insert, so `name` comes from update, rest from $setOnInsert
    expect(allUsers[0]).toMatchObject({
      name: 'Updated Name',
      email: 'new@example.com',
      bio: 'New bio',
    });
  });

  it('upsert updates when match exists', async () => {
    const orm = mongoOrm({ contract, executor: runtime });

    await orm.users.create({ name: 'Alice', email: 'alice@example.com', bio: null });

    const result = await orm.users.where(MongoFieldFilter.eq('email', 'alice@example.com')).upsert({
      create: { name: 'Should Not Insert', email: 'alice@example.com', bio: null },
      update: { name: 'Alice Upserted' },
    });

    expect(result).toBeDefined();

    const allUsers = await orm.users.all();
    expect(allUsers).toHaveLength(1);
    expect(allUsers[0]).toMatchObject({ name: 'Alice Upserted', email: 'alice@example.com' });
  });
});
