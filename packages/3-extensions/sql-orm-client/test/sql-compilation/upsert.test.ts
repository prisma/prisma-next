import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import {
  createCollection,
  createReturningCollectionFor,
  withReturningCapability,
} from '../collection-fixtures';
import { createMockRuntime, createTestContract } from '../helpers';
import { serializePlans } from './helpers';

describe('sql-compilation/upsert', () => {
  it('upsert() inserts or updates and returns a row', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const upserted = await collection.upsert({
      create: { id: 1, name: 'Alice', email: 'alice@example.com' },
      update: { name: 'Alice Updated' },
      conflictOn: { id: 1 },
    });

    expect(upserted).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    const sqlText = runtime.executions[0]!.plan.sql.toLowerCase();
    expect(sqlText).toContain('on conflict');
    expect(sqlText).toContain('do update');
    expect(sqlText).toContain('returning');
  });

  it('upsert() defaults conflict columns to primary key', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    await collection.upsert({
      create: { id: 1, name: 'Alice', email: 'alice@example.com' },
      update: { name: 'Alice Updated' },
    });

    expect(runtime.executions[0]!.plan.sql.toLowerCase()).toContain('on conflict ("id")');
  });

  it('upsert() requires returning capability', async () => {
    const { collection } = createCollection();

    await expect(
      collection.upsert({
        create: { id: 1, name: 'Alice', email: 'alice@example.com' },
        update: { name: 'Alice Updated' },
      }),
    ).rejects.toThrow(/requires contract capability "returning"/);
  });

  it('upsert() respects select() and include() result shaping', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([
      [{ id: 1, name: 'Alice' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
    ]);

    const upserted = await collection
      .select('name')
      .include('posts')
      .upsert({
        create: { id: 1, name: 'Alice', email: 'alice@example.com' },
        update: { name: 'Alice Updated' },
      });

    expect(upserted).toEqual({
      name: 'Alice',
      posts: [{ id: 10, title: 'Post A', userId: 1, views: 100 }],
    });
    expect('id' in upserted).toBe(false);
  });

  it('upsert() throws when no conflict columns can be resolved', async () => {
    const runtime = createMockRuntime();
    const contractWithoutPrimaryKey = withReturningCapability(createTestContract());
    delete (contractWithoutPrimaryKey.storage.tables.users as { primaryKey?: unknown }).primaryKey;

    const collection = new Collection({ contract: contractWithoutPrimaryKey, runtime }, 'User');

    await expect(
      collection.upsert({
        create: { id: 1, name: 'Alice', email: 'alice@example.com' },
        update: { name: 'Alice Updated' },
      }),
    ).rejects.toThrow(/requires conflict columns/);
  });

  it('upsert() throws when returning query yields zero rows', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[]]);

    await expect(
      collection.upsert({
        create: { id: 1, name: 'Alice', email: 'alice@example.com' },
        update: { name: 'Alice Updated' },
      }),
    ).rejects.toThrow(/did not return a row/);
  });

  it('captures upsert plan snapshots', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    await collection.upsert({
      create: { id: 1, name: 'Alice', email: 'alice@example.com' },
      update: { name: 'Alice Updated' },
    });

    expect(serializePlans(runtime)).toMatchInlineSnapshot(`
      [
        {
          "lane": "orm-client",
          "params": [
            1,
            "Alice",
            "alice@example.com",
            "Alice Updated",
          ],
          "sql": "insert into "users" ("id", "name", "email") values ($1, $2, $3) on conflict ("id") do update set "name" = $4 returning *",
        },
      ]
    `);
  });
});
