import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createCollection, createReturningCollectionFor } from '../collection-fixtures';
import { normalizeSql, serializePlans } from './helpers';

describe('sql-compilation/delete', { timeout: timeouts.typeScriptCompilation }, () => {
  it('delete() returns first deleted row', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const deleted = await collection.where({ id: 1 }).delete();

    expect(deleted).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'delete from "users" where "users"."id" = $1 returning *',
    );
  });

  it('deleteAll() returns all deleted rows', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([
      [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ],
    ]);

    const deleted = await collection.where({ name: 'Old' }).deleteAll();

    expect(deleted).toEqual([
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' },
    ]);
  });

  it('deleteCount() returns matched row count without requiring returning', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 1 }, { id: 2 }], []]);

    const count = await collection.where({ name: 'Old' }).deleteCount();

    expect(count).toBe(2);
    expect(runtime.executions).toHaveLength(2);
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'select "users"."id" from "users" where "users"."name" = $1',
    );
    expect(normalizeSql(runtime.executions[1]!.plan.sql)).toBe(
      'delete from "users" where "users"."name" = $1',
    );
  });

  it('delete() and deleteAll() require returning capability', async () => {
    const { collection } = createCollection();
    const filtered = collection.where({ id: 1 });

    await expect(filtered.delete()).rejects.toThrow(/requires contract capability "returning"/);

    expect(() => filtered.deleteAll()).toThrow(/requires contract capability "returning"/);
  });

  it('delete() respects select() and include() result shaping', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([
      [{ id: 1, name: 'Alice' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
    ]);

    const deleted = await collection.where({ id: 1 }).select('name').include('posts').delete();

    expect(deleted).toEqual({
      name: 'Alice',
      posts: [{ id: 10, title: 'Post A', userId: 1, views: 100 }],
    });
    expect(deleted).not.toBeNull();
    if (deleted) {
      expect('id' in deleted).toBe(false);
    }
  });

  it('delete() returns null when no rows are deleted', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[]]);

    const deleted = await collection.where({ id: 1 }).delete();

    expect(deleted).toBeNull();
  });

  it('captures deleteCount plan snapshots', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 1 }, { id: 2 }], []]);

    await collection.where({ name: 'Old' }).deleteCount();

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
            "Old",
          ],
          "sql": "delete from "users" where "users"."name" = $1",
        },
      ]
    `);
  });
});
