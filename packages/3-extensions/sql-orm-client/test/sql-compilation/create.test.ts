import { describe, expect, it } from 'vitest';
import { createCollection, createReturningCollectionFor } from '../collection-fixtures';
import { serializePlans } from './helpers';

describe('sql-compilation/create', () => {
  it('create() inserts a row and returns mapped model fields', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 5, name: 'Eve', email: 'eve@example.com' }]]);

    const created = await collection.create({ id: 5, name: 'Eve', email: 'eve@example.com' });

    expect(created).toEqual({ id: 5, name: 'Eve', email: 'eve@example.com' });
    expect(runtime.executions[0]!.plan.sql.toLowerCase()).toContain('insert');
    expect(runtime.executions[0]!.plan.sql.toLowerCase()).toContain('returning');
  });

  it('createAll() inserts many rows and streams returning rows', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([
      [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ],
    ]);

    const created = await collection
      .createAll([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]);

    expect(created).toEqual([
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' },
    ]);
  });

  it('createCount() executes insert without requiring returning and returns count', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    const count = await collection.createCount([
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' },
    ]);

    expect(count).toBe(2);
    expect(runtime.executions[0]!.plan.sql.toLowerCase()).toContain('insert');
    expect(runtime.executions[0]!.plan.sql.toLowerCase()).not.toContain('returning');
  });

  it('create() and createAll() require returning capability', async () => {
    const { collection } = createCollection();

    await expect(
      collection.create({ id: 1, name: 'Alice', email: 'alice@example.com' }),
    ).rejects.toThrow(/requires contract capability "returning"/);

    expect(() =>
      collection.createAll([{ id: 1, name: 'Alice', email: 'alice@example.com' }]),
    ).toThrow(/requires contract capability "returning"/);
  });

  it('create() respects select() and include() result shaping', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([
      [{ id: 1, name: 'Alice' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
    ]);

    const created = await collection
      .select('name')
      .include('posts')
      .create({ id: 1, name: 'Alice', email: 'alice@example.com' });

    expect(created).toEqual({
      name: 'Alice',
      posts: [{ id: 10, title: 'Post A', userId: 1, views: 100 }],
    });
    expect('id' in created).toBe(false);
  });

  it('createAll([]) returns no rows and emits no execution plans', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');

    const created = await collection.createAll([]);

    expect(created).toEqual([]);
    expect(runtime.executions).toHaveLength(0);
  });

  it('create() throws when returning query yields zero rows', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[]]);

    await expect(
      collection.create({ id: 1, name: 'Alice', email: 'alice@example.com' }),
    ).rejects.toThrow(/did not return a row/);
  });

  it('captures insert plan snapshots for select+include create flow', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([
      [{ id: 1, name: 'Alice' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
    ]);

    await collection
      .select('name')
      .include('posts')
      .create({ id: 1, name: 'Alice', email: 'alice@example.com' });

    expect(serializePlans(runtime)).toMatchInlineSnapshot(`
      [
        {
          "lane": "orm-client",
          "params": [
            1,
            "Alice",
            "alice@example.com",
          ],
          "sql": "insert into "users" ("id", "name", "email") values ($1, $2, $3) returning "name", "id"",
        },
        {
          "lane": "orm-client",
          "params": [
            1,
          ],
          "sql": "select * from "posts" where "user_id" in ($1)",
        },
      ]
    `);
  });
});
