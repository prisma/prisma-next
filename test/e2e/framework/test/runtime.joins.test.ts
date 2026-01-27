import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTestRuntimeFromClient,
  setupE2EDatabase,
} from '@prisma-next/integration-tests/test/utils';
import { sql } from '@prisma-next/sql-lane/sql';
import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import {
  createStubAdapter,
  createTestContext,
  executePlanAndCollect,
} from '@prisma-next/sql-runtime/test/utils';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { loadContractFromDisk } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

/**
 * Sets up the join test schema by dropping and creating user/post/comment tables.
 * Calls the provided setup function for test-specific data insertion.
 */
async function setupJoinTestSchema(
  client: Parameters<Parameters<typeof withClient>[1]>[0],
  contract: Contract,
  setupFn: (c: Parameters<Parameters<typeof withClient>[1]>[0]) => Promise<void>,
): Promise<void> {
  await setupE2EDatabase(client, contract, async (c) => {
    await c.query('drop table if exists "comment"');
    await c.query('drop table if exists "post"');
    await c.query('drop table if exists "user"');
    await c.query(
      'create table "user" (id serial primary key, email text not null, created_at timestamptz not null default now(), update_at timestamptz)',
    );
    await c.query(
      'create table "post" (id serial primary key, "userId" int4 not null, title text not null, created_at timestamptz not null default now(), update_at timestamptz)',
    );
    await c.query(
      'create table "comment" (id serial primary key, "postId" int4 not null, content text not null, created_at timestamptz not null default now(), update_at timestamptz)',
    );
    await setupFn(c);
  });
}

/**
 * Creates a test runtime and context for join tests.
 * Returns runtime, context, and tables for use in tests.
 */
function createJoinTestRuntime(
  client: Parameters<Parameters<typeof withClient>[1]>[0],
  contract: Contract,
): {
  runtime: ReturnType<typeof createTestRuntimeFromClient>;
  context: ReturnType<typeof createTestContext>;
  tables: ReturnType<typeof schema<Contract>>['tables'];
} {
  const runtime = createTestRuntimeFromClient(contract, client);
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const tables = schema(context).tables;
  return { runtime, context, tables };
}

describe('end-to-end JOIN queries', () => {
  it(
    'INNER JOIN returns matching rows',
    async () => {
      const contract = await loadContractFromDisk<Contract>(contractJsonPath);

      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          await setupJoinTestSchema(client, contract, async (c) => {
            await c.query('insert into "user" (email) values ($1), ($2), ($3)', [
              'ada@example.com',
              'tess@example.com',
              'mike@example.com',
            ]);
            await c.query(
              'insert into "post" ("userId", title) values ($1, $2), ($1, $3), ($4, $5)',
              [1, 'First Post', 'Second Post', 2, 'Third Post'],
            );
          });

          const { runtime, context, tables } = createJoinTestRuntime(client, contract);
          const user = tables.user!;
          const post = tables.post!;
          try {
            const plan = sql({ context })
              .from(user)
              .innerJoin(post, (on) => on.eqCol(user.columns.id!, post.columns.userId!))
              .select({
                userId: user.columns.id!,
                email: user.columns.email!,
                postId: post.columns.id!,
                title: post.columns.title!,
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);

            expect(rows.length).toBe(3);
            expect(rows[0]).toMatchObject({
              userId: expect.any(Number),
              email: expect.any(String),
              postId: expect.any(Number),
              title: expect.any(String),
            });

            expect(plan.meta.refs?.tables).toContain('user');
            expect(plan.meta.refs?.tables).toContain('post');
            expect(plan.meta.refs?.columns).toEqual(
              expect.arrayContaining([
                { table: 'user', column: 'id' },
                { table: 'post', column: 'userId' },
              ]),
            );
          } finally {
            await runtime.close();
          }
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'LEFT JOIN returns all users including those without posts',
    async () => {
      const contract = await loadContractFromDisk<Contract>(contractJsonPath);

      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          await setupJoinTestSchema(client, contract, async (c) => {
            await c.query('insert into "user" (email) values ($1), ($2), ($3)', [
              'ada@example.com',
              'tess@example.com',
              'mike@example.com',
            ]);
            await c.query('insert into "post" ("userId", title) values ($1, $2)', [
              1,
              'First Post',
            ]);
          });

          const { runtime, context, tables } = createJoinTestRuntime(client, contract);
          const user = tables.user!;
          const post = tables.post!;
          try {
            const plan = sql({ context })
              .from(user)
              .leftJoin(post, (on) => on.eqCol(user.columns.id!, post.columns.userId!))
              .select({
                userId: user.columns.id!,
                email: user.columns.email!,
                postId: post.columns.id!,
                title: post.columns.title!,
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);
            type Row = ResultType<typeof plan>;

            expect(rows.length).toBe(3);
            const adaRow = rows.find((r: Row) => r.email === 'ada@example.com');
            const tessRow = rows.find((r: Row) => r.email === 'tess@example.com');
            const mikeRow = rows.find((r: Row) => r.email === 'mike@example.com');

            expect(adaRow).toMatchObject({
              email: 'ada@example.com',
              postId: expect.anything(),
              title: expect.anything(),
            });

            expect(tessRow).toMatchObject({
              email: 'tess@example.com',
              postId: null,
              title: null,
            });

            expect(mikeRow).toMatchObject({
              email: 'mike@example.com',
              postId: null,
              title: null,
            });

            expect(plan.meta.refs?.tables).toContain('user');
            expect(plan.meta.refs?.tables).toContain('post');
          } finally {
            await runtime.close();
          }
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'RIGHT JOIN returns all posts including those without users',
    async () => {
      const contract = await loadContractFromDisk<Contract>(contractJsonPath);

      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          await setupJoinTestSchema(client, contract, async (c) => {
            await c.query('insert into "user" (email) values ($1)', ['ada@example.com']);
            await c.query('insert into "post" ("userId", title) values ($1, $2), ($3, $4)', [
              1,
              'First Post',
              999,
              'Orphan Post',
            ]);
          });

          const { runtime, context, tables } = createJoinTestRuntime(client, contract);
          const user = tables.user!;
          const post = tables.post!;
          try {
            const plan = sql({ context })
              .from(user)
              .rightJoin(post, (on) => on.eqCol(user.columns.id!, post.columns.userId!))
              .select({
                userId: user.columns.id!,
                email: user.columns.email!,
                postId: post.columns.id!,
                title: post.columns.title!,
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);
            type Row = ResultType<typeof plan>;

            expect(rows.length).toBe(2);
            const firstPostRow = rows.find((r: Row) => r.title === 'First Post');
            const orphanPostRow = rows.find((r: Row) => r.title === 'Orphan Post');

            expect(firstPostRow).toMatchObject({
              title: 'First Post',
              userId: expect.anything(),
              email: expect.anything(),
            });

            expect(orphanPostRow).toMatchObject({
              title: 'Orphan Post',
              userId: null,
              email: null,
            });

            expect(plan.meta.refs?.tables).toContain('user');
            expect(plan.meta.refs?.tables).toContain('post');
          } finally {
            await runtime.close();
          }
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'FULL JOIN returns all users and posts',
    async () => {
      const contract = await loadContractFromDisk<Contract>(contractJsonPath);

      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          await setupJoinTestSchema(client, contract, async (c) => {
            await c.query('insert into "user" (email) values ($1), ($2)', [
              'ada@example.com',
              'tess@example.com',
            ]);
            await c.query('insert into "post" ("userId", title) values ($1, $2), ($3, $4)', [
              1,
              'First Post',
              999,
              'Orphan Post',
            ]);
          });

          const { runtime, context, tables } = createJoinTestRuntime(client, contract);
          const user = tables.user!;
          const post = tables.post!;
          try {
            const plan = sql({ context })
              .from(user)
              .fullJoin(post, (on) => on.eqCol(user.columns.id!, post.columns.userId!))
              .select({
                userId: user.columns.id!,
                email: user.columns.email!,
                postId: post.columns.id!,
                title: post.columns.title!,
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);
            type Row = ResultType<typeof plan>;

            expect(rows.length).toBe(3);
            const adaRow = rows.find((r: Row) => r.email === 'ada@example.com');
            const tessRow = rows.find((r: Row) => r.email === 'tess@example.com');
            const orphanRow = rows.find((r: Row) => r.title === 'Orphan Post');

            expect(adaRow).toMatchObject({
              email: 'ada@example.com',
              postId: expect.anything(),
            });

            expect(tessRow).toMatchObject({
              email: 'tess@example.com',
              postId: null,
            });

            expect(orphanRow).toMatchObject({
              title: 'Orphan Post',
              userId: null,
              email: null,
            });

            expect(plan.meta.refs?.tables).toContain('user');
            expect(plan.meta.refs?.tables).toContain('post');
          } finally {
            await runtime.close();
          }
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'chained joins (user -> post -> comment) returns correct results',
    async () => {
      const contract = await loadContractFromDisk<Contract>(contractJsonPath);

      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          await setupJoinTestSchema(client, contract, async (c) => {
            await c.query('insert into "user" (email) values ($1), ($2)', [
              'ada@example.com',
              'tess@example.com',
            ]);
            await c.query('insert into "post" ("userId", title) values ($1, $2), ($1, $3)', [
              1,
              'First Post',
              'Second Post',
            ]);
            await c.query('insert into "comment" ("postId", content) values ($1, $2), ($1, $3)', [
              1,
              'First Comment',
              'Second Comment',
            ]);
          });

          const { runtime, context, tables } = createJoinTestRuntime(client, contract);
          const user = tables.user!;
          const post = tables.post!;
          const comment = tables.comment!;
          try {
            const plan = sql({ context })
              .from(user)
              .innerJoin(post, (on) => on.eqCol(user.columns.id!, post.columns.userId!))
              .leftJoin(comment, (on) => on.eqCol(post.columns.id!, comment.columns.postId!))
              .select({
                userId: user.columns.id!,
                email: user.columns.email!,
                postId: post.columns.id!,
                title: post.columns.title!,
                commentId: comment.columns.id!,
                content: comment.columns.content!,
              })
              .build();

            const ast = plan.ast as SelectAst | undefined;
            expect(ast?.joins).toMatchObject([
              {
                kind: 'join',
                joinType: 'inner',
                table: { kind: 'table', name: 'post' },
              },
              {
                kind: 'join',
                joinType: 'left',
                table: { kind: 'table', name: 'comment' },
              },
            ]);

            const rows = await executePlanAndCollect(runtime, plan);
            type Row = ResultType<typeof plan>;

            expect(rows.length).toBe(3);
            const firstPostRow = rows.find(
              (r: Row) => r.title === 'First Post' && r.commentId !== null,
            );
            const secondPostRow = rows.find((r: Row) => r.title === 'Second Post');

            expect(firstPostRow).toMatchObject({
              title: 'First Post',
              commentId: expect.anything(),
              content: expect.anything(),
            });

            expect(secondPostRow).toMatchObject({
              title: 'Second Post',
              commentId: null,
              content: null,
            });

            expect(plan.meta.refs?.tables).toContain('user');
            expect(plan.meta.refs?.tables).toContain('post');
            expect(plan.meta.refs?.tables).toContain('comment');
            expect(plan.meta.refs?.columns).toEqual(
              expect.arrayContaining([
                { table: 'user', column: 'id' },
                { table: 'post', column: 'userId' },
                { table: 'post', column: 'id' },
                { table: 'comment', column: 'postId' },
              ]),
            );
          } finally {
            await runtime.close();
          }
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
