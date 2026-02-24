import { describe, expect, it } from 'vitest';
import { createCollection, createReturningCollectionFor } from '../collection-fixtures';
import { normalizeSql, serializePlans } from './helpers';

describe('sql-compilation/update', () => {
  it('update() returns first updated row', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice Updated', email: 'alice@example.com' }]]);

    const updated = await collection.where({ id: 1 }).update({ name: 'Alice Updated' });

    expect(updated).toEqual({ id: 1, name: 'Alice Updated', email: 'alice@example.com' });
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'update "users" set "name" = $1 where "users"."id" = $2 returning *',
    );
  });

  it('updateAll() returns all updated rows', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([
      [
        { id: 1, name: 'Updated', email: 'alice@example.com' },
        { id: 2, name: 'Updated', email: 'bob@example.com' },
      ],
    ]);

    const updated = await collection.where({ name: 'Old' }).updateAll({ name: 'Updated' });

    expect(updated).toEqual([
      { id: 1, name: 'Updated', email: 'alice@example.com' },
      { id: 2, name: 'Updated', email: 'bob@example.com' },
    ]);
  });

  it('updateCount() returns matched row count without requiring returning', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 1 }, { id: 2 }], []]);

    const count = await collection.where({ name: 'Old' }).updateCount({ name: 'Updated' });

    expect(count).toBe(2);
    expect(runtime.executions).toHaveLength(2);
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'select "users"."id" from "users" where "users"."name" = $1',
    );
    expect(normalizeSql(runtime.executions[1]!.plan.sql)).toBe(
      'update "users" set "name" = $1 where "users"."name" = $2',
    );
  });

  it('update() and updateAll() require returning capability', async () => {
    const { collection } = createCollection();
    const filtered = collection.where({ id: 1 });

    await expect(filtered.update({ name: 'Updated' })).rejects.toThrow(
      /requires contract capability "returning"/,
    );

    expect(() => filtered.updateAll({ name: 'Updated' })).toThrow(
      /requires contract capability "returning"/,
    );
  });

  it('update() respects select() and include() result shaping', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([
      [{ id: 1, name: 'Alice' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
    ]);

    const updated = await collection
      .where({ id: 1 })
      .select('name')
      .include('posts')
      .update({ name: 'Alice' });

    expect(updated).toEqual({
      name: 'Alice',
      posts: [{ id: 10, title: 'Post A', userId: 1, views: 100 }],
    });
    expect(updated).not.toBeNull();
    if (updated) {
      expect('id' in updated).toBe(false);
    }
  });

  it('updateAll({}) returns no rows and emits no execution plans', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');

    const updated = await collection.where({ id: 1 }).updateAll({});

    expect(updated).toEqual([]);
    expect(runtime.executions).toHaveLength(0);
  });

  it('updateCount({}) returns zero without executing queries', async () => {
    const { collection, runtime } = createCollection();

    const count = await collection.where({ id: 1 }).updateCount({});

    expect(count).toBe(0);
    expect(runtime.executions).toHaveLength(0);
  });

  it('captures updateCount plan snapshots', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 1 }, { id: 2 }], []]);

    await collection.where({ name: 'Old' }).updateCount({ name: 'Updated' });

    expect(serializePlans(runtime)).toMatchInlineSnapshot(`
      [
        {
          "lane": "orm-client",
          "params": [
            "Old",
          ],
          "sql": "select "users"."id" from "users" where "users"."name" = $1",
        },
        {
          "lane": "orm-client",
          "params": [
            "Updated",
            "Old",
          ],
          "sql": "update "users" set "name" = $1 where "users"."name" = $2",
        },
      ]
    `);
  });
});
