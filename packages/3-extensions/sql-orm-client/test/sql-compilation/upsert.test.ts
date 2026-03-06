import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import {
  createCollection,
  createReturningCollectionFor,
  withReturningCapability,
} from '../collection-fixtures';
import { createMockRuntime, getTestContract } from '../helpers';
import { normalizeSql, serializePlans } from './helpers';

describe('sql-compilation/upsert', () => {
  it('upsert() inserts or updates and returns a row', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com', invited_by_id: null }],
    ]);

    const upserted = await collection.upsert({
      create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
      update: { name: 'Alice Updated' },
      conflictOn: { id: 1 },
    });

    expect(upserted).toEqual({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      invitedById: null,
    });
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'insert into "users" ("id", "name", "email", "invited_by_id") values ($1, $2, $3, $4) on conflict ("id") do update set "name" = $5 returning *',
    );
  });

  it('upsert() defaults conflict columns to primary key', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com', invited_by_id: null }],
    ]);

    await collection.upsert({
      create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
      update: { name: 'Alice Updated' },
    });

    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'insert into "users" ("id", "name", "email", "invited_by_id") values ($1, $2, $3, $4) on conflict ("id") do update set "name" = $5 returning *',
    );
  });

  it('upsert() with empty update compiles as on conflict do nothing', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const upserted = await collection.upsert({
      create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
      update: {},
    });

    expect(upserted).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    expect(serializePlans(runtime)).toMatchInlineSnapshot(`
      [
        {
          "lane": "orm-client",
          "params": [
            1,
            "Alice",
            "alice@example.com",
            null,
          ],
          "sql": "insert into "users" ("id", "name", "email", "invited_by_id") values ($1, $2, $3, $4) on conflict ("id") do nothing returning *",
        },
      ]
    `);
  });

  it('upsert() with undefined update values treats update as empty and reloads on conflict', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[], [{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const upserted = await collection.upsert({
      create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
      update: { name: undefined } as never,
    });

    expect(upserted).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    expect(runtime.executions).toHaveLength(2);
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'insert into "users" ("id", "name", "email", "invited_by_id") values ($1, $2, $3, $4) on conflict ("id") do nothing returning *',
    );
    expect(normalizeSql(runtime.executions[1]!.plan.sql)).toBe(
      'select * from "users" where "users"."id" = $1 limit $2',
    );
    expect(runtime.executions[0]!.plan.params).toEqual([1, 'Alice', 'alice@example.com', null]);
    expect(runtime.executions[1]!.plan.params).toEqual([1, 1]);
  });

  it('upsert() requires returning capability', async () => {
    const { collection } = createCollection();

    await expect(
      collection.upsert({
        create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
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
        create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
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
    const contractWithoutPrimaryKey = withReturningCapability(getTestContract());
    delete (contractWithoutPrimaryKey.storage.tables.users as { primaryKey?: unknown }).primaryKey;

    const collection = new Collection({ contract: contractWithoutPrimaryKey, runtime }, 'User');

    await expect(
      collection.upsert({
        create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
        update: { name: 'Alice Updated' },
      }),
    ).rejects.toThrow(/requires conflict columns/);
  });

  it('upsert() throws when returning query yields zero rows', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[]]);

    await expect(
      collection.upsert({
        create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
        update: { name: 'Alice Updated' },
      }),
    ).rejects.toThrow(/did not return a row/);
  });

  it('captures upsert plan snapshots', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com', invited_by_id: null }],
    ]);

    await collection.upsert({
      create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
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
            null,
            "Alice Updated",
          ],
          "sql": "insert into "users" ("id", "name", "email", "invited_by_id") values ($1, $2, $3, $4) on conflict ("id") do update set "name" = $5 returning *",
        },
      ]
    `);
  });
});
