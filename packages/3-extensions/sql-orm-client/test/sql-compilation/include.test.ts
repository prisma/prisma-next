import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { baseContract, createCollection, createCollectionFor } from '../collection-fixtures';
import { createMockRuntime, type TestContract } from '../helpers';
import { normalizeSql, serializePlans } from './helpers';

function withIncludeCapabilities(
  capabilities: Record<string, Record<string, boolean>>,
): TestContract {
  return {
    ...baseContract,
    capabilities: {
      ...baseContract.capabilities,
      ...capabilities,
    },
  } as TestContract;
}

describe('sql-compilation/include', () => {
  it('select() with include() keeps selected scalars and relation payloads', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
    ]);

    const results = await collection.select('name').include('posts').all();

    expect(results).toEqual([
      {
        name: 'Alice',
        posts: [{ id: 10, title: 'Post A', userId: 1, views: 100 }],
      },
    ]);
    expect('id' in results[0]!).toBe(false);
  });

  it('all() with include executes multiple queries and stitches results', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([
      [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ],
      [
        { id: 10, title: 'Post A', user_id: 1, views: 100 },
        { id: 11, title: 'Post B', user_id: 1, views: 200 },
        { id: 12, title: 'Post C', user_id: 2, views: 300 },
      ],
    ]);

    const results = await collection.include('posts').all();

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      id: 1,
      name: 'Alice',
      posts: [
        { id: 10, title: 'Post A', userId: 1 },
        { id: 11, title: 'Post B', userId: 1 },
      ],
    });
    expect(results[1]).toMatchObject({
      id: 2,
      name: 'Bob',
      posts: [{ id: 12, title: 'Post C', userId: 2 }],
    });
    expect(runtime.executions).toHaveLength(2);
  });

  it('all() with include returns empty relations when no children match', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }], []]);

    const results = await collection.include('posts').all();

    expect(results[0]).toMatchObject({ id: 1, posts: [] });
  });

  it('all() with include and nested take() applies limit per parent', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([
      [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ],
      [
        { id: 10, title: 'Post A', user_id: 1, views: 100 },
        { id: 11, title: 'Post B', user_id: 1, views: 200 },
        { id: 12, title: 'Post C', user_id: 2, views: 300 },
        { id: 13, title: 'Post D', user_id: 2, views: 400 },
      ],
    ]);

    const results = await collection
      .include('posts', (post) => post.orderBy((p) => p.id.asc()).take(1))
      .all();

    expect(results).toMatchObject([
      { id: 1, posts: [{ id: 10 }] },
      { id: 2, posts: [{ id: 12 }] },
    ]);
  });

  it('all() with to-one include returns a single object', async () => {
    const { collection: postCollection, runtime } = createCollectionFor('Post', baseContract);
    runtime.setNextResults([
      [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
    ]);

    const results = await postCollection.include('author').all();

    expect(results).toEqual([
      {
        id: 10,
        title: 'Post A',
        userId: 1,
        views: 100,
        author: { id: 1, name: 'Alice', email: 'alice@example.com' },
      },
    ]);
  });

  it('all() with to-one include uses null when no related row matches', async () => {
    const { collection: postCollection, runtime } = createCollectionFor('Post', baseContract);
    runtime.setNextResults([[{ id: 10, title: 'Post A', user_id: 999, views: 100 }], []]);

    const results = await postCollection.include('author').all();

    expect(results).toEqual([
      {
        id: 10,
        title: 'Post A',
        userId: 999,
        views: 100,
        author: null,
      },
    ]);
  });

  it('all() with one-to-one include returns object or null per parent row', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([
      [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ],
      [
        { id: 100, user_id: 1, bio: 'First profile' },
        { id: 200, user_id: 1, bio: 'Second profile' },
      ],
    ]);

    const results = await collection.include('profile').all();

    expect(results).toEqual([
      {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        profile: { id: 100, userId: 1, bio: 'First profile' },
      },
      {
        id: 2,
        name: 'Bob',
        email: 'bob@example.com',
        profile: null,
      },
    ]);
  });

  it('all() supports nested include dispatch', async () => {
    const { collection: postCollection, runtime } = createCollectionFor('Post', baseContract);
    runtime.setNextResults([
      [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
      [
        { id: 100, body: 'Comment A', post_id: 10 },
        { id: 101, body: 'Comment B', post_id: 10 },
      ],
    ]);

    const results = await postCollection
      .include('comments', (comment) => comment.orderBy((c) => c.id.asc()))
      .all();

    expect(results).toMatchObject([
      {
        id: 10,
        comments: [
          { id: 100, body: 'Comment A', postId: 10 },
          { id: 101, body: 'Comment B', postId: 10 },
        ],
      },
    ]);
    expect(runtime.executions).toHaveLength(2);
  });

  it('include() with parent rows missing join value returns empty relation payloads', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([
      [{ name: 'Alice', email: 'alice@example.com' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
    ]);

    const results = await collection.select('name', 'email').include('posts').all();

    expect(results).toEqual([{ name: 'Alice', email: 'alice@example.com', posts: [] }]);
  });

  it('include() supports scalar count selectors for to-many relations', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([
      [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ],
      [
        { id: 10, title: 'Post A', user_id: 1, views: 100 },
        { id: 11, title: 'Post B', user_id: 1, views: 200 },
        { id: 12, title: 'Post C', user_id: 2, views: 300 },
      ],
    ]);

    const results = await collection
      .orderBy((user) => user.id.asc())
      .include('posts', (posts) => posts.count())
      .all();

    expect(results).toEqual([
      { id: 1, name: 'Alice', email: 'alice@example.com', posts: 2 },
      { id: 2, name: 'Bob', email: 'bob@example.com', posts: 1 },
    ]);
    expect(runtime.executions).toHaveLength(2);
  });

  it('include() supports combine() with row and scalar branches', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([
      [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ],
      [
        { id: 11, title: 'Post B', user_id: 1, views: 200 },
        { id: 12, title: 'Post C', user_id: 2, views: 300 },
      ],
      [
        { id: 10, title: 'Post A', user_id: 1, views: 100 },
        { id: 11, title: 'Post B', user_id: 1, views: 200 },
        { id: 12, title: 'Post C', user_id: 2, views: 300 },
      ],
    ]);

    const results = await collection
      .orderBy((user) => user.id.asc())
      .include('posts', (posts) =>
        posts.combine({
          popular: posts.where((post) => post.views.gt(150)).orderBy((post) => post.id.asc()),
          totalCount: posts.count(),
        }),
      )
      .all();

    expect(results).toEqual([
      {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        posts: {
          popular: [{ id: 11, title: 'Post B', userId: 1, views: 200 }],
          totalCount: 2,
        },
      },
      {
        id: 2,
        name: 'Bob',
        email: 'bob@example.com',
        posts: {
          popular: [{ id: 12, title: 'Post C', userId: 2, views: 300 }],
          totalCount: 1,
        },
      },
    ]);
    expect(runtime.executions).toHaveLength(3);
    expect(normalizeSql(runtime.executions[1]!.plan.sql)).toBe(
      'select * from "posts" where "user_id" in ($1, $2) and "posts"."views" > $3 order by "id" asc',
    );
  });

  it('supports include flow when runtime exposes connection() and release()', async () => {
    const base = createMockRuntime();
    let released = false;
    const runtimeWithConnection = {
      execute: base.execute,
      setNextResults: base.setNextResults,
      executions: base.executions,
      async connection() {
        return {
          execute: base.execute,
          release: async () => {
            released = true;
          },
        };
      },
    };

    const collection = new Collection(
      { contract: baseContract, runtime: runtimeWithConnection },
      'User',
    );
    runtimeWithConnection.setNextResults?.([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
    ]);

    const results = await collection.include('posts').all();

    expect(results).toHaveLength(1);
    expect(released).toBe(true);
  });

  it('captures parent/child include plan snapshots', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }], []]);

    await collection.select('name').include('posts').all();

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

  it('uses lateral single-query include strategy when lateral and jsonAgg are enabled', async () => {
    const contract = withIncludeCapabilities({
      lateral: { enabled: true },
      jsonAgg: { enabled: true },
    });
    const { collection, runtime } = createCollectionFor('User', contract);
    runtime.setNextResults([
      [
        {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
        },
      ],
    ]);

    const results = await collection.include('posts').all();

    expect(results).toEqual([
      {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        posts: [{ id: 10, title: 'Post A', userId: 1, views: 100 }],
      },
    ]);
    expect(runtime.executions).toHaveLength(1);
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'select "__orm_parent".*, "__orm_include_0"."posts" as "posts" from (select * from "users") as "__orm_parent" left join lateral (select coalesce(json_agg(row_to_json("__orm_child_0".*)), \'[]\'::json) as "posts" from (select * from "posts" where "posts"."user_id" = "__orm_parent"."id") as "__orm_child_0") as "__orm_include_0" on true',
    );
  });

  it('lateral include strategy pushes per-parent skip/take into child SQL', async () => {
    const contract = withIncludeCapabilities({
      lateral: { enabled: true },
      jsonAgg: { enabled: true },
    });
    const { collection, runtime } = createCollectionFor('User', contract);
    runtime.setNextResults([
      [
        {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: '[{"id":11,"title":"Post B","user_id":1,"views":200}]',
        },
      ],
    ]);

    const results = await collection
      .include('posts', (post) =>
        post
          .orderBy((p) => p.id.asc())
          .skip(1)
          .take(1),
      )
      .all();

    expect(results).toEqual([
      {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        posts: [{ id: 11, title: 'Post B', userId: 1, views: 200 }],
      },
    ]);
    expect(runtime.executions).toHaveLength(1);
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'select "__orm_parent".*, "__orm_include_0"."posts" as "posts" from (select * from "users") as "__orm_parent" left join lateral (select coalesce(json_agg(row_to_json("__orm_child_0".*)), \'[]\'::json) as "posts" from (select * from "posts" where "posts"."user_id" = "__orm_parent"."id" order by "id" asc limit $1 offset $2) as "__orm_child_0") as "__orm_include_0" on true',
    );
  });

  it('uses correlated single-query include strategy when only jsonAgg is enabled', async () => {
    const contract = withIncludeCapabilities({
      jsonAgg: { enabled: true },
    });
    const { collection, runtime } = createCollectionFor('User', contract);
    runtime.setNextResults([
      [
        {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
        },
      ],
    ]);

    const results = await collection.include('posts').all();

    expect(results).toEqual([
      {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        posts: [{ id: 10, title: 'Post A', userId: 1, views: 100 }],
      },
    ]);
    expect(runtime.executions).toHaveLength(1);
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'select "__orm_parent".*, (select coalesce(json_agg(row_to_json("__orm_child_0".*)), \'[]\'::json) as "posts" from (select * from "posts" where "posts"."user_id" = "__orm_parent"."id") as "__orm_child_0") as "posts" from (select * from "users") as "__orm_parent"',
    );
  });

  it('falls back to multi-query strategy for nested includes even when lateral is enabled', async () => {
    const contract = withIncludeCapabilities({
      lateral: { enabled: true },
      jsonAgg: { enabled: true },
    });
    const { collection, runtime } = createCollectionFor('User', contract);
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
      [{ id: 100, body: 'Comment A', post_id: 10 }],
    ]);

    const results = await collection
      .include('posts', (post) =>
        post.include('comments', (comment) => comment.orderBy((c) => c.id.asc())),
      )
      .all();

    expect(results).toEqual([
      {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        posts: [
          {
            id: 10,
            title: 'Post A',
            userId: 1,
            views: 100,
            comments: [{ id: 100, body: 'Comment A', postId: 10 }],
          },
        ],
      },
    ]);
    expect(runtime.executions).toHaveLength(3);
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe('select * from "users"');
  });
});
