import {
  ColumnRef,
  DerivedTableSource,
  JsonArrayAggExpr,
  JsonObjectExpr,
  OrderByItem,
  SubqueryExpr,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { getTestContract, isSelectAst } from '../helpers';
import {
  createPostsCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './helpers';
import { seedComments, seedPosts, seedProfiles, seedUsers } from './runtime-helpers';

function createUsersCollectionWithCapabilities(
  runtime: Parameters<typeof createUsersCollection>[0],
  capabilities: Record<string, unknown>,
) {
  const base = getTestContract();
  const contract = {
    ...base,
    capabilities: {
      ...base.capabilities,
      ...capabilities,
    },
  } as typeof base;

  return new Collection({ contract, runtime }, 'User');
}

type NumericPostField = import('../../src/types').NumericFieldNames<
  ReturnType<typeof getTestContract>,
  'Post'
>;

describe('integration/include', () => {
  it(
    'include() stitches one-to-many and one-to-one relations from real rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);
        await seedProfiles(runtime, [{ id: 100, userId: 1, bio: 'Primary profile' }]);

        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) => posts.orderBy((post) => post.id.asc()))
          .include('profile')
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            posts: [
              { id: 10, title: 'Post A', userId: 1, views: 100 },
              { id: 11, title: 'Post B', userId: 1, views: 200 },
            ],
            profile: { id: 100, userId: 1, bio: 'Primary profile' },
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            posts: [{ id: 12, title: 'Post C', userId: 2, views: 300 }],
            profile: null,
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() supports scalar count() on to-many relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);
        await seedComments(runtime, [
          { id: 100, body: 'Comment A', postId: 10 },
          { id: 101, body: 'Comment B', postId: 10 },
          { id: 102, body: 'Comment C', postId: 12 },
        ]);

        runtime.resetExecutions();
        const rows = await posts
          .orderBy((post) => post.id.asc())
          .include('comments', (comments) => comments.count())
          .all();

        expect(rows).toEqual([
          { id: 10, title: 'Post A', userId: 1, views: 100, comments: 2 },
          { id: 11, title: 'Post B', userId: 1, views: 200, comments: 0 },
          { id: 12, title: 'Post C', userId: 2, views: 300, comments: 1 },
        ]);
        expect(runtime.executions).toHaveLength(2);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() supports scalar sum() on to-many relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);

        runtime.resetExecutions();
        const numericField: NumericPostField = 'views';
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) => posts.sum(numericField))
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, posts: 300 },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null, posts: 300 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: null, posts: null },
        ]);
        expect(runtime.executions).toHaveLength(2);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() supports scalar avg(), min(), and max() on to-many relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);

        runtime.resetExecutions();
        const numericField: NumericPostField = 'views';
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) =>
            posts.combine({
              avgViews: posts.avg(numericField),
              minViews: posts.min(numericField),
              maxViews: posts.max(numericField),
            }),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            posts: { avgViews: 150, minViews: 100, maxViews: 200 },
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            posts: { avgViews: 300, minViews: 300, maxViews: 300 },
          },
          {
            id: 3,
            name: 'Cara',
            email: 'cara@example.com',
            invitedById: null,
            posts: { avgViews: null, minViews: null, maxViews: null },
          },
        ]);
        expect(runtime.executions).toHaveLength(4);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() combine() evaluates branches independently',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 250 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) =>
            posts.combine({
              popular: posts.where((post) => post.views.gte(200)).orderBy((post) => post.id.asc()),
              latestOne: posts.orderBy((post) => post.id.desc()).take(1),
              totalCount: posts.count(),
            }),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            posts: {
              popular: [{ id: 11, title: 'Post B', userId: 1, views: 250 }],
              latestOne: [{ id: 11, title: 'Post B', userId: 1, views: 250 }],
              totalCount: 2,
            },
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            posts: {
              popular: [{ id: 12, title: 'Post C', userId: 2, views: 300 }],
              latestOne: [{ id: 12, title: 'Post C', userId: 2, views: 300 }],
              totalCount: 1,
            },
          },
        ]);
        expect(runtime.executions).toHaveLength(4);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'single-query include uses lateral strategy when lateral and jsonAgg are enabled',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollectionWithCapabilities(runtime, {
          lateral: { enabled: true },
          jsonAgg: { enabled: true },
        });

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) =>
            posts
              .orderBy((post) => post.id.asc())
              .skip(1)
              .take(1),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            posts: [{ id: 11, title: 'Post B', userId: 1, views: 200 }],
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            posts: [],
          },
        ]);
        expect(runtime.executions).toHaveLength(1);

        const plan = runtime.executions[0];
        const ast = plan?.ast;
        expect(isSelectAst(ast)).toBe(true);
        if (!isSelectAst(ast)) {
          throw new Error('Expected select AST for lateral include query');
        }
        const includeJoin = ast.joins?.find(
          (join) =>
            join.lateral &&
            join.source instanceof DerivedTableSource &&
            join.source.alias === 'posts_lateral',
        );
        expect(includeJoin).toBeDefined();
        if (includeJoin?.source instanceof DerivedTableSource) {
          const includeAggregateProjection = includeJoin.source.query.project[0];
          expect(includeAggregateProjection?.expr).toBeInstanceOf(JsonArrayAggExpr);
          if (includeAggregateProjection?.expr instanceof JsonArrayAggExpr) {
            expect(includeAggregateProjection.expr.onEmpty).toBe('emptyArray');
            expect(includeAggregateProjection.expr.expr).toBeInstanceOf(JsonObjectExpr);
            expect(includeAggregateProjection.expr.orderBy).toEqual([
              OrderByItem.asc(ColumnRef.of('posts__rows', 'posts__order_0')),
            ]);
          }
          const rowsSource = includeJoin.source.query.from;
          expect(rowsSource).toBeInstanceOf(DerivedTableSource);
          if (rowsSource instanceof DerivedTableSource) {
            expect(rowsSource.query.limit).toBe(1);
            expect(rowsSource.query.offset).toBe(1);
            expect(rowsSource.query.project.map((item) => item.alias)).toContain('posts__order_0');
          }
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'single-query lateral include correlates self-relations with child alias',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollectionWithCapabilities(runtime, {
          lateral: { enabled: true },
          jsonAgg: { enabled: true },
        });

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
          { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2 },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('invitedUsers', (invitedUsers) =>
            invitedUsers.orderBy((invitedUser) => invitedUser.id.asc()),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            invitedUsers: [
              { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
              { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
            ],
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: 1,
            invitedUsers: [{ id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2 }],
          },
          {
            id: 3,
            name: 'Cara',
            email: 'cara@example.com',
            invitedById: 1,
            invitedUsers: [],
          },
          {
            id: 4,
            name: 'Dan',
            email: 'dan@example.com',
            invitedById: 2,
            invitedUsers: [],
          },
        ]);
        expect(runtime.executions).toHaveLength(1);
        const plan = runtime.executions[0];
        const ast = plan?.ast;
        expect(isSelectAst(ast)).toBe(true);
        if (!isSelectAst(ast)) {
          throw new Error('Expected select AST for lateral self-relation include query');
        }
        const includeJoin = ast.joins?.find(
          (join) =>
            join.lateral &&
            join.source instanceof DerivedTableSource &&
            join.source.alias === 'invitedUsers_lateral',
        );
        expect(includeJoin).toBeDefined();
        if (includeJoin?.source instanceof DerivedTableSource) {
          const includeAggregateProjection = includeJoin.source.query.project[0];
          expect(includeAggregateProjection?.expr).toBeInstanceOf(JsonArrayAggExpr);
          if (includeAggregateProjection?.expr instanceof JsonArrayAggExpr) {
            expect(includeAggregateProjection.expr.orderBy).toEqual([
              OrderByItem.asc(ColumnRef.of('invitedUsers__rows', 'invitedUsers__order_0')),
            ]);
          }
          const rowsSource = includeJoin.source.query.from;
          expect(rowsSource).toBeInstanceOf(DerivedTableSource);
          if (rowsSource instanceof DerivedTableSource) {
            expect(rowsSource.query.project.map((item) => item.alias)).toContain(
              'invitedUsers__order_0',
            );
          }
        }
        const sql = runtime.executions[0]?.sql;
        expect(sql).toContain('"invitedUsers__child"."invited_by_id" = "users"."id"');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'single-query include uses correlated strategy when only jsonAgg is enabled',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollectionWithCapabilities(runtime, {
          jsonAgg: { enabled: true },
        });

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedPosts(runtime, [{ id: 10, title: 'Post A', userId: 1, views: 100 }]);

        runtime.resetExecutions();
        const rows = await users.include('posts').all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            posts: [{ id: 10, title: 'Post A', userId: 1, views: 100 }],
          },
        ]);
        expect(runtime.executions).toHaveLength(1);

        const plan = runtime.executions[0];
        const ast = plan?.ast;
        expect(isSelectAst(ast)).toBe(true);
        if (!isSelectAst(ast)) {
          throw new Error('Expected select AST for correlated include query');
        }
        expect(ast.joins ?? []).toHaveLength(0);
        const postsProjection = ast.project.find((item) => item.alias === 'posts');
        expect(postsProjection?.expr).toBeInstanceOf(SubqueryExpr);
        if (postsProjection?.expr instanceof SubqueryExpr) {
          const includeAggregateProjection = postsProjection.expr.query.project[0];
          expect(includeAggregateProjection?.expr).toBeInstanceOf(JsonArrayAggExpr);
          if (includeAggregateProjection?.expr instanceof JsonArrayAggExpr) {
            expect(includeAggregateProjection.expr.onEmpty).toBe('emptyArray');
            expect(includeAggregateProjection.expr.expr).toBeInstanceOf(JsonObjectExpr);
          }
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'single-query correlated include correlates self-relations with child alias',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollectionWithCapabilities(runtime, {
          jsonAgg: { enabled: true },
        });

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
          { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2 },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('invitedUsers', (invitedUsers) =>
            invitedUsers.orderBy((invitedUser) => invitedUser.id.asc()),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            invitedUsers: [
              { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
              { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
            ],
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: 1,
            invitedUsers: [{ id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2 }],
          },
          {
            id: 3,
            name: 'Cara',
            email: 'cara@example.com',
            invitedById: 1,
            invitedUsers: [],
          },
          {
            id: 4,
            name: 'Dan',
            email: 'dan@example.com',
            invitedById: 2,
            invitedUsers: [],
          },
        ]);
        expect(runtime.executions).toHaveLength(1);
        const plan = runtime.executions[0];
        const ast = plan?.ast;
        expect(isSelectAst(ast)).toBe(true);
        if (!isSelectAst(ast)) {
          throw new Error('Expected select AST for correlated self-relation include query');
        }
        const invitedUsersProjection = ast.project.find((item) => item.alias === 'invitedUsers');
        expect(invitedUsersProjection?.expr).toBeInstanceOf(SubqueryExpr);
        if (invitedUsersProjection?.expr instanceof SubqueryExpr) {
          const includeAggregateProjection = invitedUsersProjection.expr.query.project[0];
          expect(includeAggregateProjection?.expr).toBeInstanceOf(JsonArrayAggExpr);
          if (includeAggregateProjection?.expr instanceof JsonArrayAggExpr) {
            expect(includeAggregateProjection.expr.orderBy).toEqual([
              OrderByItem.asc(ColumnRef.of('invitedUsers__rows', 'invitedUsers__order_0')),
            ]);
          }
          const rowsSource = invitedUsersProjection.expr.query.from;
          expect(rowsSource).toBeInstanceOf(DerivedTableSource);
          if (rowsSource instanceof DerivedTableSource) {
            expect(rowsSource.query.project.map((item) => item.alias)).toContain(
              'invitedUsers__order_0',
            );
          }
        }
        const sql = runtime.executions[0]?.sql;
        expect(sql).toContain('"invitedUsers__child"."invited_by_id" = "users"."id"');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() supports nested 2-level includes (users -> posts -> comments)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);
        await seedComments(runtime, [
          { id: 100, body: 'Comment A', postId: 10 },
          { id: 101, body: 'Comment B', postId: 10 },
          { id: 102, body: 'Comment C', postId: 11 },
        ]);

        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) =>
            posts
              .orderBy((post) => post.id.asc())
              .include('comments', (comments) => comments.orderBy((c) => c.id.asc())),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            posts: [
              {
                id: 10,
                title: 'Post A',
                userId: 1,
                views: 100,
                comments: [
                  { id: 100, body: 'Comment A', postId: 10 },
                  { id: 101, body: 'Comment B', postId: 10 },
                ],
              },
              {
                id: 11,
                title: 'Post B',
                userId: 1,
                views: 200,
                comments: [{ id: 102, body: 'Comment C', postId: 11 }],
              },
            ],
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            posts: [
              {
                id: 12,
                title: 'Post C',
                userId: 2,
                views: 300,
                comments: [],
              },
            ],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
