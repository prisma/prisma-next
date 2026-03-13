import {
  AndExpr,
  BinaryExpr,
  type BoundWhereExpr,
  ColumnRef,
  LiteralExpr,
  NullCheckExpr,
  ParamRef,
  type ToWhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createBoundWhereExpr } from '../src/where-utils';
import {
  baseContract,
  createCollection,
  createCollectionFor,
  createReturningCollectionFor,
} from './collection-fixtures';

function bound(
  expr: BoundWhereExpr['expr'],
  params: readonly unknown[] = [],
  paramDescriptors = params.map((_, index) => ({ source: 'lane' as const, index: index + 1 })),
): BoundWhereExpr {
  return {
    expr,
    params,
    paramDescriptors,
  };
}

describe('Collection', () => {
  describe('chain methods', () => {
    it('where() appends rich filters and stays immutable', () => {
      const { collection } = createCollection();

      const filtered = collection.where((user) => user.name.eq('Alice'));
      expect(filtered.state.filters).toEqual([
        createBoundWhereExpr(BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice'))),
      ]);
      expect(collection.state.filters).toEqual([]);

      const chained = filtered.where((user) => user.email.neq('old@example.com'));
      expect(chained.state.filters).toEqual([
        createBoundWhereExpr(BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice'))),
        createBoundWhereExpr(
          BinaryExpr.neq(ColumnRef.of('users', 'email'), LiteralExpr.of('old@example.com')),
        ),
      ]);
    });

    it('where() accepts ToWhereExpr payloads and rejects bare ParamRef expressions', () => {
      const { collection } = createCollection();

      const filtered = collection.where(
        (_user) =>
          ({
            toWhereExpr: () => ({
              expr: BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of(1, 'name')),
              params: ['Alice'],
              paramDescriptors: [{ source: 'lane' as const }],
            }),
          }) satisfies ToWhereExpr,
      );

      expect(filtered.state.filters).toEqual([
        bound(BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of(1, 'name')), ['Alice']),
      ]);

      expect(() =>
        collection.where((_user) =>
          BinaryExpr.eq(ColumnRef.of('users', 'id'), ParamRef.of(1, 'id')),
        ),
      ).toThrow(/bare WhereExpr.*ParamRef/i);
    });

    it('where() accepts shorthand filters, handles null and undefined, and treats {} as identity', () => {
      const { collection } = createCollection();

      const filtered = collection.where({
        name: 'Alice',
        email: null,
        id: undefined!,
      });

      expect(filtered.state.filters).toEqual([
        createBoundWhereExpr(
          AndExpr.of([
            BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
            NullCheckExpr.isNull(ColumnRef.of('users', 'email')),
          ]),
        ),
      ]);

      expect(collection.where({})).toBe(collection);
    });

    it('select() replaces the prior selection set', () => {
      const { collection: postCollection } = createCollectionFor('Post', baseContract);

      const selected = postCollection.select('title');
      const reselected = selected.select('userId');

      expect(selected.state.selectedFields).toEqual(['title']);
      expect(reselected.state.selectedFields).toEqual(['user_id']);
    });

    it('orderBy() appends later directives', () => {
      const { collection: postCollection } = createCollectionFor('Post', baseContract);

      const ordered = postCollection.orderBy((post) => post.userId.asc());
      const reordered = ordered.orderBy((post) => post.id.desc());

      expect(ordered.state.orderBy).toEqual([{ column: 'user_id', direction: 'asc' }]);
      expect(reordered.state.orderBy).toEqual([
        { column: 'user_id', direction: 'asc' },
        { column: 'id', direction: 'desc' },
      ]);
    });

    it('tracks ordering, paging, selection, distinct, and cursor state', () => {
      const { collection: postCollection } = createCollectionFor('Post', baseContract);

      const ordered = postCollection.orderBy((post) => post.userId.asc());
      expect(ordered.state.orderBy).toEqual([{ column: 'user_id', direction: 'asc' }]);

      const paged = ordered.cursor({ userId: 7 }).take(10).skip(5);
      expect(paged.state.cursor).toEqual({ user_id: 7 });
      expect(paged.state.limit).toBe(10);
      expect(paged.state.offset).toBe(5);

      expect(postCollection.distinct('userId').state.distinct).toEqual(['user_id']);
      expect(ordered.distinctOn('userId').state.distinctOn).toEqual(['user_id']);
      expect(postCollection.select('userId').state.selectedFields).toEqual(['user_id']);
    });

    it('captures include metadata, scalar selectors, and combine branches', () => {
      const { collection } = createCollection();

      const withPosts = collection.include('posts', (posts) =>
        posts.where((post) => post.views.gt(100)).take(5),
      );
      expect(withPosts.state.includes[0]).toMatchObject({
        relationName: 'posts',
        relatedModelName: 'Post',
        relatedTableName: 'posts',
        fkColumn: 'user_id',
        cardinality: '1:N',
      });
      expect(withPosts.state.includes[0]?.nested.filters).toEqual([
        createBoundWhereExpr(BinaryExpr.gt(ColumnRef.of('posts', 'views'), LiteralExpr.of(100))),
      ]);
      expect(withPosts.state.includes[0]?.nested.limit).toBe(5);
      expect(collection.state.includes).toEqual([]);

      const withPostCount = collection.include('posts', (posts) =>
        posts.where((post) => post.views.gt(100)).count(),
      );
      expect(withPostCount.state.includes[0]?.scalar).toMatchObject({
        kind: 'includeScalar',
        fn: 'count',
      });
      expect(withPostCount.state.includes[0]?.scalar?.state.filters).toEqual([
        createBoundWhereExpr(BinaryExpr.gt(ColumnRef.of('posts', 'views'), LiteralExpr.of(100))),
      ]);

      const combined = collection.include('posts', (posts) =>
        posts.combine({
          recent: posts.orderBy((post) => post.id.desc()).take(1),
          totalCount: posts.count(),
        }),
      );
      const recentBranch = combined.state.includes[0]?.combine?.['recent'];
      expect(recentBranch?.kind).toBe('rows');
      if (recentBranch?.kind === 'rows') {
        expect(recentBranch.state.limit).toBe(1);
      }

      const totalCountBranch = combined.state.includes[0]?.combine?.['totalCount'];
      expect(totalCountBranch?.kind).toBe('scalar');
      if (totalCountBranch?.kind === 'scalar') {
        expect(totalCountBranch.selector.fn).toBe('count');
      }
    });

    it('captures to-one metadata and rejects unsupported to-one refinements', () => {
      const { collection: postCollection } = createCollectionFor('Post', baseContract);

      expect(postCollection.include('author').state.includes[0]).toMatchObject({
        relationName: 'author',
        relatedModelName: 'User',
        relatedTableName: 'users',
        fkColumn: 'id',
        parentPkColumn: 'user_id',
        cardinality: 'N:1',
      });

      expect(() =>
        postCollection.include(
          'author',
          (author) => (author as unknown as { count: () => unknown }).count() as never,
        ),
      ).toThrow(/scalar aggregations are only supported for to-many relations/);

      expect(() =>
        postCollection.include(
          'author',
          (author) =>
            (
              author as unknown as {
                combine: (spec: Record<string, unknown>) => unknown;
                count: () => unknown;
              }
            ).combine({
              count: (author as unknown as { count: () => unknown }).count(),
            }) as never,
        ),
      ).toThrow(/combine\(\) is only supported for to-many relations/);
    });

    it('rejects invalid include refinement returns and invalid branches', () => {
      const { collection } = createCollection();

      expect(() => collection.include('posts', () => ({ invalid: true }) as never)).toThrow(
        /refinement must return a collection/,
      );
      expect(() =>
        collection.include('posts', (posts) =>
          posts.combine({
            invalid: { nope: true } as never,
          }),
        ),
      ).toThrow(/branch "invalid" is invalid/);
      expect(() => collection.count()).toThrow(
        /only available inside include\(\) refinement callbacks/,
      );
      expect(() => collection.sum('id' as never)).toThrow(
        /only available inside include\(\) refinement callbacks/,
      );
      expect(() => collection.combine({} as never)).toThrow(
        /only available inside include\(\) refinement callbacks/,
      );
    });

    it('keeps cursor() as identity when mapped cursor values are empty', () => {
      const { collection } = createCollection();
      const ordered = collection.orderBy((user) => user.id.asc());
      expect(ordered.cursor({ id: undefined } as never)).toBe(ordered);
    });
  });

  describe('operation guards', () => {
    it('aggregate() validates selector shape and handles empty runtime rows', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[]]);

      await expect(collection.aggregate(() => ({}))).rejects.toThrow(
        /requires at least one aggregation selector/,
      );
      await expect(
        collection.aggregate(() => ({ invalid: { kind: 'nope' } as never })),
      ).rejects.toThrow(/selector "invalid" is invalid/);

      await expect(
        collection.aggregate((aggregate) => ({
          count: aggregate.count(),
        })),
      ).resolves.toEqual({ count: 0 });
    });

    it('createCount() returns 0 for empty payloads', async () => {
      const { collection } = createCollection();
      await expect(collection.createCount([])).resolves.toBe(0);
    });

    it('create() nested mutation throws when reload by primary key returns no row', async () => {
      const { collection, runtime } = createReturningCollectionFor('User');
      runtime.setNextResults([
        [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
        [{ id: 10, title: 'Post', user_id: 1, views: 1 }],
        [],
      ]);

      await expect(
        collection.create({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: (posts: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
            posts.create([
              {
                id: 10,
                title: 'Post',
                views: 1,
              },
            ]),
        } as never),
      ).rejects.toThrow(/did not return a row/);
    }, 500);

    it('update() returns null when nested or scalar updates return no rows', async () => {
      const { collection: nestedCollection, runtime: nestedRuntime } =
        createReturningCollectionFor('User');
      nestedRuntime.setNextResults([[]]);

      const nestedUpdated = await nestedCollection.where({ id: 1 }).update({
        posts: (posts: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          posts.connect({ id: 10 }),
      } as never);
      expect(nestedUpdated).toBeNull();

      const { collection: updateCollection, runtime: updateRuntime } =
        createReturningCollectionFor('User');
      updateRuntime.setNextResults([[]]);

      const updated = await updateCollection.where({ id: 1 }).update({ name: 'Updated' });
      expect(updated).toBeNull();
    });
  });
});
