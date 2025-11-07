import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import {
  createTestRuntimeFromClient,
  executePlanAndCollect,
  setupE2EDatabase,
} from '@prisma-next/runtime/test/utils';
import { schema } from '@prisma-next/sql-query/schema';
import { sql } from '@prisma-next/sql-query/sql';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { loadContractFromDisk } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('end-to-end JOIN queries', () => {
  it('INNER JOIN returns matching rows', async () => {
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
            const tables = schema<Contract, CodecTypes>(contract).tables;
            const user = tables.user!;
            const post = tables.post!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
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
  }, timeouts.spinUpPpgDev);

  it('LEFT JOIN returns all users including those without posts', async () => {
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
            const tables = schema<Contract, CodecTypes>(contract).tables;
            const user = tables.user!;
            const post = tables.post!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
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

            expect(adaRow).toBeDefined();
            expect(adaRow?.postId).not.toBeNull();
            expect(adaRow?.title).not.toBeNull();

            expect(tessRow).toBeDefined();
            expect(tessRow?.postId).toBeNull();
            expect(tessRow?.title).toBeNull();

            expect(mikeRow).toBeDefined();
            expect(mikeRow?.postId).toBeNull();
            expect(mikeRow?.title).toBeNull();

            expect(plan.meta.refs?.tables).toContain('user');
            expect(plan.meta.refs?.tables).toContain('post');
          } finally {
            await runtime.close();
          }
        });
      },
      { acceleratePort: 54040, databasePort: 54041, shadowDatabasePort: 54042 },
    );
  });

  it('RIGHT JOIN returns all posts including those without users', async () => {
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
            const tables = schema<Contract, CodecTypes>(contract).tables;
            const user = tables.user!;
            const post = tables.post!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
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

            expect(firstPostRow).toBeDefined();
            expect(firstPostRow?.userId).not.toBeNull();
            expect(firstPostRow?.email).not.toBeNull();

            expect(orphanPostRow).toBeDefined();
            expect(orphanPostRow?.userId).toBeNull();
            expect(orphanPostRow?.email).toBeNull();

            expect(plan.meta.refs?.tables).toContain('user');
            expect(plan.meta.refs?.tables).toContain('post');
          } finally {
            await runtime.close();
          }
        });
      },
      { acceleratePort: 54050, databasePort: 54051, shadowDatabasePort: 54052 },
    );
  });

  it('FULL JOIN returns all users and posts', async () => {
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
            const tables = schema<Contract, CodecTypes>(contract).tables;
            const user = tables.user!;
            const post = tables.post!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
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

            expect(adaRow).toBeDefined();
            expect(adaRow?.postId).not.toBeNull();

            expect(tessRow).toBeDefined();
            expect(tessRow?.postId).toBeNull();

            expect(orphanRow).toBeDefined();
            expect(orphanRow?.userId).toBeNull();
            expect(orphanRow?.email).toBeNull();

            expect(plan.meta.refs?.tables).toContain('user');
            expect(plan.meta.refs?.tables).toContain('post');
          } finally {
            await runtime.close();
          }
        });
      },
      { acceleratePort: 54060, databasePort: 54061, shadowDatabasePort: 54062 },
    );
  });

  it('chained joins (user -> post -> comment) returns correct results', async () => {
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
            const tables = schema<Contract, CodecTypes>(contract).tables;
            const user = tables.user!;
            const post = tables.post!;
            const comment = tables.comment!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
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

            expect(plan.ast?.joins).toEqual([
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

            expect(firstPostRow).toBeDefined();
            expect(firstPostRow?.commentId).not.toBeNull();
            expect(firstPostRow?.content).not.toBeNull();

            expect(secondPostRow).toBeDefined();
            expect(secondPostRow?.commentId).toBeNull();
            expect(secondPostRow?.content).toBeNull();

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
      { acceleratePort: 54070, databasePort: 54071, shadowDatabasePort: 54072 },
    );
  });
});
