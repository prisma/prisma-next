import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { baseContract, createCollection, createCollectionFor } from '../collection-fixtures';
import { createMockRuntime } from '../helpers';
import { serializePlans } from './helpers';

describe('sql-compilation/include', () => {
  it('select() with include() keeps selected scalars and relation payloads', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
    ]);

    const results = await collection.select('name').include('posts').all().toArray();

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

    const results = await collection.include('posts').all().toArray();

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

    const results = await collection.include('posts').all().toArray();

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
      .all()
      .toArray();

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

    const results = await postCollection.include('author').all().toArray();

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

    const results = await postCollection.include('author').all().toArray();

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

    const results = await collection.include('profile').all().toArray();

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
      .all()
      .toArray();

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

    const results = await collection.select('name', 'email').include('posts').all().toArray();

    expect(results).toEqual([{ name: 'Alice', email: 'alice@example.com', posts: [] }]);
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

    const results = await collection.include('posts').all().toArray();

    expect(results).toHaveLength(1);
    expect(released).toBe(true);
  });

  it('captures parent/child include plan snapshots', async () => {
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
});
