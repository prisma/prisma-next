import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { sql } from '@prisma-next/sql-lane/sql';
import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createRuntimeContext } from '@prisma-next/sql-runtime';
import {
  createTestRuntimeFromClient,
  executePlanAndCollect,
  setupE2EDatabase,
} from '@prisma-next/sql-runtime/test/utils';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { loadContractFromDisk } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('end-to-end JOIN queries', () => {
  it(
    'INNER JOIN returns matching rows',
    async () => {
      const contract = await loadContractFromDisk<Contract>(contractJsonPath);

      await withDevDatabase(
        async ({ connectionString }: { connectionString: string }) => {
          await withClient(connectionString, async (client: import('pg').Client) => {
            await setupE2EDatabase(client, contract, async (c: typeof client) => {
              await c.query('drop table if exists "comment"');
              await c.query('drop table if exists "post"');
              await c.query('drop table if exists "user"');
              await c.query('create table "user" (id serial primary key, email text not null)');
              await c.query(
                'create table "post" (id serial primary key, "userId" int4 not null, title text not null)',
              );
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

            const adapter = createPostgresAdapter();
            const runtime = createTestRuntimeFromClient(contract, client, adapter);
            try {
              const context = createRuntimeContext({ contract, adapter, extensions: [] });
              const tables = schema(context).tables;
              const user = tables.user!;
              const post = tables.post!;
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
        },
        { acceleratePort: 54030, databasePort: 54031, shadowDatabasePort: 54032 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'LEFT JOIN returns all users including those without posts',
    async () => {
      const contract = await loadContractFromDisk<Contract>(contractJsonPath);

      await withDevDatabase(
        async ({ connectionString }: { connectionString: string }) => {
          await withClient(connectionString, async (client: import('pg').Client) => {
            await setupE2EDatabase(client, contract, async (c: typeof client) => {
              await c.query('drop table if exists "comment"');
              await c.query('drop table if exists "post"');
              await c.query('drop table if exists "user"');
              await c.query('create table "user" (id serial primary key, email text not null)');
              await c.query(
                'create table "post" (id serial primary key, "userId" int4 not null, title text not null)',
              );
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

            const adapter = createPostgresAdapter();
            const runtime = createTestRuntimeFromClient(contract, client, adapter);
            try {
              const context = createRuntimeContext({ contract, adapter, extensions: [] });
              const tables = schema<Contract>(context).tables;
              const user = tables.user!;
              const post = tables.post!;
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

              expect(rows.length).toBe(3);
              const adaRow = rows.find((r: (typeof rows)[0]) => r.email === 'ada@example.com');
              const tessRow = rows.find((r: (typeof rows)[0]) => r.email === 'tess@example.com');
              const mikeRow = rows.find((r: (typeof rows)[0]) => r.email === 'mike@example.com');

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
        },
        { acceleratePort: 54040, databasePort: 54041, shadowDatabasePort: 54042 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'RIGHT JOIN returns all posts including those without users',
    async () => {
      const contract = await loadContractFromDisk<Contract>(contractJsonPath);

      await withDevDatabase(
        async ({ connectionString }: { connectionString: string }) => {
          await withClient(connectionString, async (client: import('pg').Client) => {
            await setupE2EDatabase(client, contract, async (c: typeof client) => {
              await c.query('drop table if exists "comment"');
              await c.query('drop table if exists "post"');
              await c.query('drop table if exists "user"');
              await c.query('create table "user" (id serial primary key, email text not null)');
              await c.query(
                'create table "post" (id serial primary key, "userId" int4 not null, title text not null)',
              );
              await c.query('insert into "user" (email) values ($1)', ['ada@example.com']);
              await c.query('insert into "post" ("userId", title) values ($1, $2), ($3, $4)', [
                1,
                'First Post',
                999,
                'Orphan Post',
              ]);
            });

            const adapter = createPostgresAdapter();
            const runtime = createTestRuntimeFromClient(contract, client, adapter);
            try {
              const context = createRuntimeContext({ contract, adapter, extensions: [] });
              const tables = schema<Contract>(context).tables;
              const user = tables.user!;
              const post = tables.post!;
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

              expect(rows.length).toBe(2);
              const firstPostRow = rows.find((r: (typeof rows)[0]) => r.title === 'First Post');
              const orphanPostRow = rows.find((r: (typeof rows)[0]) => r.title === 'Orphan Post');

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
        },
        { acceleratePort: 54130, databasePort: 54131, shadowDatabasePort: 54132 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'FULL JOIN returns all users and posts',
    async () => {
      const contract = await loadContractFromDisk<Contract>(contractJsonPath);

      await withDevDatabase(
        async ({ connectionString }: { connectionString: string }) => {
          await withClient(connectionString, async (client: import('pg').Client) => {
            await setupE2EDatabase(client, contract, async (c: typeof client) => {
              await c.query('drop table if exists "comment"');
              await c.query('drop table if exists "post"');
              await c.query('drop table if exists "user"');
              await c.query('create table "user" (id serial primary key, email text not null)');
              await c.query(
                'create table "post" (id serial primary key, "userId" int4 not null, title text not null)',
              );
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

            const adapter = createPostgresAdapter();
            const runtime = createTestRuntimeFromClient(contract, client, adapter);
            try {
              const context = createRuntimeContext({ contract, adapter, extensions: [] });
              const tables = schema<Contract>(context).tables;
              const user = tables.user!;
              const post = tables.post!;
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

              expect(rows.length).toBe(3);
              const adaRow = rows.find((r: (typeof rows)[0]) => r.email === 'ada@example.com');
              const tessRow = rows.find((r: (typeof rows)[0]) => r.email === 'tess@example.com');
              const orphanRow = rows.find((r: (typeof rows)[0]) => r.title === 'Orphan Post');

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
        },
        { acceleratePort: 54140, databasePort: 54141, shadowDatabasePort: 54142 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'chained joins (user -> post -> comment) returns correct results',
    async () => {
      const contract = await loadContractFromDisk<Contract>(contractJsonPath);

      await withDevDatabase(
        async ({ connectionString }: { connectionString: string }) => {
          await withClient(connectionString, async (client: import('pg').Client) => {
            await setupE2EDatabase(client, contract, async (c: typeof client) => {
              await c.query('drop table if exists "comment"');
              await c.query('drop table if exists "post"');
              await c.query('drop table if exists "user"');
              await c.query('create table "user" (id serial primary key, email text not null)');
              await c.query(
                'create table "post" (id serial primary key, "userId" int4 not null, title text not null)',
              );
              await c.query(
                'create table "comment" (id serial primary key, "postId" int4 not null, content text not null)',
              );
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

            const adapter = createPostgresAdapter();
            const runtime = createTestRuntimeFromClient(contract, client, adapter);
            try {
              const context = createRuntimeContext({ contract, adapter, extensions: [] });
              const tables = schema(context).tables;
              const user = tables.user!;
              const post = tables.post!;
              const comment = tables.comment!;
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

              expect(rows.length).toBe(3);
              const firstPostRow = rows.find(
                (r: (typeof rows)[0]) => r.title === 'First Post' && r.commentId !== null,
              );
              const secondPostRow = rows.find((r: (typeof rows)[0]) => r.title === 'Second Post');

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
        },
        { acceleratePort: 54150, databasePort: 54151, shadowDatabasePort: 54152 },
      );
    },
    timeouts.spinUpPpgDev,
  );
});
