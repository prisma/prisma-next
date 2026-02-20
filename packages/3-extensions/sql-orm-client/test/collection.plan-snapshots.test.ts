import { describe, expect, it } from 'vitest';
import {
  createCollection,
  createCollectionFor,
  createReturningCollectionFor,
} from './collection-fixtures';
import type { MockRuntime } from './helpers';

function normalizeSql(sqlText: string): string {
  return sqlText.replace(/\s+/g, ' ').trim();
}

function serializePlans(runtime: MockRuntime) {
  return runtime.executions.map(({ plan }) => ({
    lane: plan.meta.lane,
    sql: normalizeSql(plan.sql),
    params: plan.params,
  }));
}

describe('Collection plan snapshots', () => {
  it('captures parent and child query plans for include()', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }], []]);

    await collection.select('name').include('posts').all().toArray();

    expect(serializePlans(runtime)).toMatchInlineSnapshot(`
      [
        {
          "lane": "orm-client",
          "params": [],
          "sql": "select "users"."name", "users"."id" from "users"",
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

  it('captures mixed-direction cursor pagination SQL', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection
      .orderBy([(user) => user.name.asc(), (user) => user.email.desc()])
      .cursor({ name: 'Alice', email: 'z@example.com' })
      .all()
      .toArray();

    expect(serializePlans(runtime)).toMatchInlineSnapshot(`
      [
        {
          "lane": "orm-client",
          "params": [
            "Alice",
            "Alice",
            "z@example.com",
          ],
          "sql": "select * from "users" where "users"."name" > $1 or ("users"."name" = $2 and "users"."email" < $3) order by "name" asc, "email" desc",
        },
      ]
    `);
  });

  it('captures upsert returning SQL plan', async () => {
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

  it('captures updateCount plan pair (count query + mutation query)', async () => {
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

  it('captures deleteCount plan pair (count query + mutation query)', async () => {
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

  it('captures relation include SQL for to-one relation', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ id: 10, title: 'Post A', user_id: 1, views: 10 }], []]);

    await collection.include('author').all().toArray();

    expect(serializePlans(runtime)).toMatchInlineSnapshot(`
      [
        {
          "lane": "orm-client",
          "params": [],
          "sql": "select * from "posts"",
        },
        {
          "lane": "orm-client",
          "params": [
            1,
          ],
          "sql": "select * from "users" where "id" in ($1)",
        },
      ]
    `);
  });
});
