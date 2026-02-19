import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { createMockRuntime, createTestContract } from './helpers';

describe('Collection', () => {
  const contract = createTestContract();

  function createCollection() {
    const runtime = createMockRuntime();
    const collection = new Collection({ contract, runtime }, 'User');
    return { collection, runtime };
  }

  describe('chain methods', () => {
    it('where() appends a filter and returns new collection', () => {
      const { collection } = createCollection();
      const filtered = collection.where((u) => u.name.eq('Alice'));
      expect(filtered.state.filters).toHaveLength(1);
      expect(filtered.state.filters[0]).toEqual({
        column: 'name',
        op: 'eq',
        value: 'Alice',
      });
      // Original is not mutated
      expect(collection.state.filters).toHaveLength(0);
    });

    it('where() can be chained multiple times', () => {
      const { collection } = createCollection();
      const filtered = collection
        .where((u) => u.name.eq('Alice'))
        .where((u) => u.email.neq('old@example.com'));
      expect(filtered.state.filters).toHaveLength(2);
    });

    it('take() sets limit', () => {
      const { collection } = createCollection();
      const limited = collection.take(10);
      expect(limited.state.limit).toBe(10);
      expect(collection.state.limit).toBeUndefined();
    });

    it('skip() sets offset', () => {
      const { collection } = createCollection();
      const skipped = collection.skip(5);
      expect(skipped.state.offset).toBe(5);
      expect(collection.state.offset).toBeUndefined();
    });

    it('include() appends an include expression', () => {
      const { collection } = createCollection();
      const withPosts = collection.include('posts');
      expect(withPosts.state.includes).toHaveLength(1);
      expect(withPosts.state.includes[0]).toMatchObject({
        relationName: 'posts',
        relatedModelName: 'Post',
        relatedTableName: 'posts',
        fkColumn: 'user_id',
      });
      // Original is not mutated
      expect(collection.state.includes).toHaveLength(0);
    });

    it('include() with refine callback captures nested state', () => {
      const { collection } = createCollection();
      const withPosts = collection.include('posts', (p) =>
        p.where((post) => post.views.gt(100)).take(5),
      );
      const inc = withPosts.state.includes[0]!;
      expect(inc.nested.filters).toHaveLength(1);
      expect(inc.nested.filters[0]).toEqual({
        column: 'views',
        op: 'gt',
        value: 100,
      });
      expect(inc.nested.limit).toBe(5);
    });
  });

  describe('terminal methods', () => {
    it('all() compiles and executes a SELECT query', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
      const results = await collection.all().toArray();
      expect(results).toEqual([{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
      expect(runtime.executions).toHaveLength(1);
      expect(runtime.executions[0]!.plan.sql).toContain('select');
      expect(runtime.executions[0]!.plan.sql).toContain('"users"');
      expect(runtime.executions[0]!.plan.meta.lane).toBe('orm-client');
    });

    it('all() with where() produces WHERE clause', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
      await collection
        .where((u) => u.name.eq('Alice'))
        .all()
        .toArray();
      const sql = runtime.executions[0]!.plan.sql;
      expect(sql).toContain('where');
      expect(sql).toContain('"name"');
    });

    it('all() with take/skip adds LIMIT/OFFSET', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[]]);
      await collection.take(10).skip(5).all().toArray();
      const sql = runtime.executions[0]!.plan.sql;
      expect(sql).toContain('limit');
      expect(sql).toContain('offset');
    });

    it('find() adds limit 1', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
      const result = await collection.find();
      expect(result).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
      const sql = runtime.executions[0]!.plan.sql;
      expect(sql).toContain('limit');
    });

    it('all() with include executes multiple queries and stitches results', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([
        // Parent query result
        [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ],
        // Child query result (posts)
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

      // Should have 2 executions: parent + child
      expect(runtime.executions).toHaveLength(2);
    });

    it('all() with include returns empty relations when no children match', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([
        [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
        [], // No posts
      ]);

      const results = await collection.include('posts').all().toArray();
      expect(results[0]).toMatchObject({
        id: 1,
        posts: [],
      });
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
        .include('posts', (post) =>
          post.orderBy(() => ({ column: 'id', direction: 'asc' })).take(1),
        )
        .all()
        .toArray();

      expect(results).toMatchObject([
        { id: 1, posts: [{ id: 10 }] },
        { id: 2, posts: [{ id: 12 }] },
      ]);
    });

    it('all() supports nested include dispatch', async () => {
      const runtime = createMockRuntime();
      const postCollection = new Collection({ contract, runtime }, 'Post');
      runtime.setNextResults([
        [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
        [
          { id: 100, body: 'Comment A', post_id: 10 },
          { id: 101, body: 'Comment B', post_id: 10 },
        ],
      ]);

      const results = await postCollection
        .include('comments', (comment) =>
          comment.orderBy(() => ({ column: 'id', direction: 'asc' })),
        )
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
  });
});
