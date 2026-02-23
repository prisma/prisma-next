import { describe, expect, it } from 'vitest';
import { baseContract, createCollection, createCollectionFor } from './collection-fixtures';

describe('Collection', () => {
  const contract = baseContract;

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
      const { collection: postCollection } = createCollectionFor('Post', contract);
      const paged = postCollection.orderBy((p) => p.userId.asc()).cursor({ userId: 7 });

      expect(paged.state.cursor).toEqual({ user_id: 7 });
    });

    it('distinct() and distinctOn() map fields to storage columns', () => {
      const { collection: postCollection } = createCollectionFor('Post', contract);

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

    it('include() supports scalar selectors for to-many relations', () => {
      const { collection } = createCollection();
      const withPostCount = collection.include('posts', (posts) =>
        posts.where((post) => post.views.gt(100)).count(),
      );

      const include = withPostCount.state.includes[0]!;
      expect(include.scalar).toMatchObject({
        kind: 'includeScalar',
        fn: 'count',
      });
      expect(include.scalar?.state.filters).toHaveLength(1);
      expect(include.combine).toBeUndefined();
    });

    it('include() supports combine() branches with independent states', () => {
      const { collection } = createCollection();
      const combined = collection.include('posts', (posts) =>
        posts.combine({
          recent: posts.orderBy((post) => post.id.desc()).take(1),
          totalCount: posts.count(),
        }),
      );

      const include = combined.state.includes[0]!;
      expect(include.combine).toBeDefined();
      expect(include.scalar).toBeUndefined();
      expect(include.nested.filters).toHaveLength(0);

      const recentBranch = include.combine?.['recent'];
      expect(recentBranch?.kind).toBe('rows');
      if (recentBranch?.kind === 'rows') {
        expect(recentBranch.state.limit).toBe(1);
      }

      const totalCountBranch = include.combine?.['totalCount'];
      expect(totalCountBranch?.kind).toBe('scalar');
      if (totalCountBranch?.kind === 'scalar') {
        expect(totalCountBranch.selector.fn).toBe('count');
      }
    });

    it('include() captures to-one relation metadata', () => {
      const { collection: postCollection } = createCollectionFor('Post', contract);
      const withAuthor = postCollection.include('author');

      expect(withAuthor.state.includes[0]).toMatchObject({
        relationName: 'author',
        relatedModelName: 'User',
        relatedTableName: 'users',
        fkColumn: 'id',
        parentPkColumn: 'user_id',
        cardinality: 'N:1',
      });
    });
  });
});
