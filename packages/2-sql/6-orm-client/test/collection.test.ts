import { describe, expect, it } from 'vitest';
import { Repository } from '../src/repository';
import { createMockRuntime, createTestContract } from './helpers';

describe('Collection', () => {
  const contract = createTestContract();

  function createRepo() {
    const runtime = createMockRuntime();
    const repo = new Repository({ contract, runtime }, 'User');
    return { repo, runtime };
  }

  describe('chain methods', () => {
    it('where() appends a filter and returns new collection', () => {
      const { repo } = createRepo();
      const filtered = repo.where((u) => u.name.eq('Alice'));
      expect(filtered.state.filters).toHaveLength(1);
      expect(filtered.state.filters[0]).toEqual({
        column: 'name',
        op: 'eq',
        value: 'Alice',
      });
      // Original is not mutated
      expect(repo.state.filters).toHaveLength(0);
    });

    it('where() can be chained multiple times', () => {
      const { repo } = createRepo();
      const filtered = repo
        .where((u) => u.name.eq('Alice'))
        .where((u) => u.email.neq('old@example.com'));
      expect(filtered.state.filters).toHaveLength(2);
    });

    it('take() sets limit', () => {
      const { repo } = createRepo();
      const limited = repo.take(10);
      expect(limited.state.limit).toBe(10);
      expect(repo.state.limit).toBeUndefined();
    });

    it('skip() sets offset', () => {
      const { repo } = createRepo();
      const skipped = repo.skip(5);
      expect(skipped.state.offset).toBe(5);
      expect(repo.state.offset).toBeUndefined();
    });

    it('include() appends an include expression', () => {
      const { repo } = createRepo();
      const withPosts = repo.include('posts');
      expect(withPosts.state.includes).toHaveLength(1);
      expect(withPosts.state.includes[0]).toMatchObject({
        relationName: 'posts',
        relatedModelName: 'Post',
        relatedTableName: 'posts',
        fkColumn: 'user_id',
      });
      // Original is not mutated
      expect(repo.state.includes).toHaveLength(0);
    });

    it('include() with refine callback captures nested state', () => {
      const { repo } = createRepo();
      const withPosts = repo.include('posts', (p) => p.where((post) => post.views.gt(100)).take(5));
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
    it('findMany() compiles and executes a SELECT query', async () => {
      const { repo, runtime } = createRepo();
      runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
      const results = await repo.findMany().toArray();
      expect(results).toEqual([{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
      expect(runtime.executions).toHaveLength(1);
      expect(runtime.executions[0]!.plan.sql).toContain('select');
      expect(runtime.executions[0]!.plan.sql).toContain('"users"');
      expect(runtime.executions[0]!.plan.meta.lane).toBe('repository');
    });

    it('findMany() with where() produces WHERE clause', async () => {
      const { repo, runtime } = createRepo();
      runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
      await repo
        .where((u) => u.name.eq('Alice'))
        .findMany()
        .toArray();
      const sql = runtime.executions[0]!.plan.sql;
      expect(sql).toContain('where');
      expect(sql).toContain('"name"');
    });

    it('findMany() with take/skip adds LIMIT/OFFSET', async () => {
      const { repo, runtime } = createRepo();
      runtime.setNextResults([[]]);
      await repo.take(10).skip(5).findMany().toArray();
      const sql = runtime.executions[0]!.plan.sql;
      expect(sql).toContain('limit');
      expect(sql).toContain('offset');
    });

    it('findFirst() adds limit 1', async () => {
      const { repo, runtime } = createRepo();
      runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
      await repo.findFirst().toArray();
      const sql = runtime.executions[0]!.plan.sql;
      expect(sql).toContain('limit');
    });

    it('findMany() with include executes multiple queries and stitches results', async () => {
      const { repo, runtime } = createRepo();
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

      const results = await repo.include('posts').findMany().toArray();

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

    it('findMany() with include returns empty relations when no children match', async () => {
      const { repo, runtime } = createRepo();
      runtime.setNextResults([
        [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
        [], // No posts
      ]);

      const results = await repo.include('posts').findMany().toArray();
      expect(results[0]).toMatchObject({
        id: 1,
        posts: [],
      });
    });

    it('findMany() with include and nested take() applies limit per parent', async () => {
      const { repo, runtime } = createRepo();
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

      const results = await repo
        .include('posts', (post) =>
          post.orderBy(() => ({ column: 'id', direction: 'asc' })).take(1),
        )
        .findMany()
        .toArray();

      expect(results).toMatchObject([
        { id: 1, posts: [{ id: 10 }] },
        { id: 2, posts: [{ id: 12 }] },
      ]);
    });

    it('findMany() supports nested include dispatch', async () => {
      const runtime = createMockRuntime();
      const postRepo = new Repository({ contract, runtime }, 'Post');
      runtime.setNextResults([
        [{ id: 10, title: 'Post A', user_id: 1, views: 100 }],
        [
          { id: 100, body: 'Comment A', post_id: 10 },
          { id: 101, body: 'Comment B', post_id: 10 },
        ],
      ]);

      const results = await postRepo
        .include('comments', (comment) =>
          comment.orderBy(() => ({ column: 'id', direction: 'asc' })),
        )
        .findMany()
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
