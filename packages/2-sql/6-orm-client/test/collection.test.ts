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
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: 'users', column: 'name' },
        right: { kind: 'literal', value: 'Alice' },
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

    it('where() accepts shorthand object filters', () => {
      const { collection } = createCollection();
      const filtered = collection.where({ name: 'Alice', email: 'alice@example.com' });
      expect(filtered.state.filters).toHaveLength(1);
      expect(filtered.state.filters[0]).toEqual({
        kind: 'and',
        exprs: [
          {
            kind: 'bin',
            op: 'eq',
            left: { kind: 'col', table: 'users', column: 'name' },
            right: { kind: 'literal', value: 'Alice' },
          },
          {
            kind: 'bin',
            op: 'eq',
            left: { kind: 'col', table: 'users', column: 'email' },
            right: { kind: 'literal', value: 'alice@example.com' },
          },
        ],
      });
    });

    it('where() converts null and ignores undefined in shorthand filters', () => {
      const { collection } = createCollection();
      const filtered = collection.where({
        email: null,
        // biome-ignore lint/style/noNonNullAssertion: test intentionally checks undefined omission
        name: undefined!,
      });

      expect(filtered.state.filters).toHaveLength(1);
      expect(filtered.state.filters[0]).toEqual({
        kind: 'nullCheck',
        expr: { kind: 'col', table: 'users', column: 'email' },
        isNull: true,
      });
    });

    it('where({}) is identity', () => {
      const { collection } = createCollection();
      const filtered = collection.where({});
      expect(filtered).toBe(collection);
      expect(filtered.state.filters).toHaveLength(0);
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

    it('orderBy() accepts typed accessor directives', () => {
      const { collection } = createCollection();
      const ordered = collection.orderBy((u) => u.name.desc());
      expect(ordered.state.orderBy).toEqual([{ column: 'name', direction: 'desc' }]);
    });

    it('orderBy() accepts an array of accessor directives', () => {
      const { collection } = createCollection();
      const ordered = collection.orderBy([(u) => u.name.asc(), (u) => u.email.asc()]);
      expect(ordered.state.orderBy).toEqual([
        { column: 'name', direction: 'asc' },
        { column: 'email', direction: 'asc' },
      ]);
    });

    it('chained orderBy() appends directives', () => {
      const { collection } = createCollection();
      const ordered = collection.orderBy((u) => u.name.asc()).orderBy((u) => u.email.desc());
      expect(ordered.state.orderBy).toEqual([
        { column: 'name', direction: 'asc' },
        { column: 'email', direction: 'desc' },
      ]);
    });

    it('cursor() stores mapped order cursor values', () => {
      const runtime = createMockRuntime();
      const postCollection = new Collection({ contract, runtime }, 'Post');
      const paged = postCollection.orderBy((p) => p.userId.asc()).cursor({ userId: 7 });

      expect(paged.state.cursor).toEqual({ user_id: 7 });
    });

    it('distinct() and distinctOn() map fields to storage columns', () => {
      const runtime = createMockRuntime();
      const postCollection = new Collection({ contract, runtime }, 'Post');

      const distinctCollection = postCollection.distinct('userId');
      expect(distinctCollection.state.distinct).toEqual(['user_id']);

      const distinctOnCollection = postCollection
        .orderBy((p) => p.userId.asc())
        .distinctOn('userId');
      expect(distinctOnCollection.state.distinctOn).toEqual(['user_id']);
    });

    it('select() stores mapped selected fields and replaces previous selections', () => {
      const { collection } = createCollection();
      const selected = collection.select('name', 'email');
      expect(selected.state.selectedFields).toEqual(['name', 'email']);

      const replaced = selected.select('email');
      expect(replaced.state.selectedFields).toEqual(['email']);
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
        cardinality: '1:N',
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
        kind: 'bin',
        op: 'gt',
        left: { kind: 'col', table: 'posts', column: 'views' },
        right: { kind: 'literal', value: 100 },
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

    it('select() narrows projected fields in runtime results', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[{ name: 'Alice', email: 'alice@example.com' }]]);

      const result = await collection.select('name', 'email').all().toArray();
      expect(result).toEqual([{ name: 'Alice', email: 'alice@example.com' }]);
    });

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

    it('all() with take/skip adds LIMIT/OFFSET', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[]]);
      await collection.take(10).skip(5).all().toArray();
      const sql = runtime.executions[0]!.plan.sql;
      expect(sql).toContain('limit');
      expect(sql).toContain('offset');
    });

    it('all() with cursor() applies a single-column cursor boundary', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[]]);

      await collection
        .orderBy((u) => u.id.asc())
        .cursor({ id: 42 })
        .take(10)
        .all()
        .toArray();

      const sql = runtime.executions[0]!.plan.sql.toLowerCase();
      expect(sql).toContain('"users"."id" >');
    });

    it('all() with compound cursor() compiles tuple comparison', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[]]);

      await collection
        .orderBy([(u) => u.name.asc(), (u) => u.email.asc()])
        .cursor({ name: 'Alice', email: 'alice@example.com' })
        .all()
        .toArray();

      const sql = runtime.executions[0]!.plan.sql.toLowerCase();
      expect(sql).toContain('("users"."name", "users"."email") >');
    });

    it('all() with distinct() compiles SELECT DISTINCT', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[]]);

      await collection.distinct('email').all().toArray();

      const sql = runtime.executions[0]!.plan.sql.toLowerCase();
      expect(sql).toContain('select distinct');
    });

    it('all() with distinctOn() compiles DISTINCT ON', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[]]);

      await collection
        .orderBy((u) => u.email.asc())
        .distinctOn('email')
        .all()
        .toArray();

      const sql = runtime.executions[0]!.plan.sql.toLowerCase();
      expect(sql).toContain('distinct on');
      expect(sql).toContain('("users"."email")');
    });

    it('select() compiles to an explicit projection instead of selectAll()', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[]]);

      await collection.select('name', 'email').all().toArray();
      const sql = runtime.executions[0]!.plan.sql.toLowerCase();
      expect(sql).toContain('"users"."name"');
      expect(sql).toContain('"users"."email"');
      expect(sql).not.toContain('*');
    });

    it('find() adds limit 1', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
      const result = await collection.find();
      expect(result).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
      const sql = runtime.executions[0]!.plan.sql;
      expect(sql).toContain('limit');
    });

    it('find() accepts shorthand object filters', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[{ id: 42, name: 'Alice', email: 'alice@example.com' }]]);
      const result = await collection.find({ id: 42 });

      expect(result).toEqual({ id: 42, name: 'Alice', email: 'alice@example.com' });
      expect(runtime.executions[0]!.plan.sql).toContain('"id"');
      expect(runtime.executions[0]!.plan.sql).toContain('limit');
    });

    it('find() combines inline filters with pre-existing where() filters', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[{ id: 42, name: 'Alice', email: 'alice@example.com' }]]);
      await collection.where({ name: 'Alice' }).find((u) => u.id.eq(42));

      const sql = runtime.executions[0]!.plan.sql;
      expect(sql).toContain('"name"');
      expect(sql).toContain('"id"');
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
        .include('posts', (post) => post.orderBy((p) => p.id.asc()).take(1))
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
  });
});
