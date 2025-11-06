import { describe, it, expect, expectTypeOf } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { sql } from '@prisma-next/sql-query/sql';
import { schema } from '@prisma-next/sql-query/schema';
import type { ResultType } from '@prisma-next/sql-query/types';
import {
  withDevDatabase,
  withClient,
  loadContractFromDisk,
  emitAndVerifyContract,
  setupE2EDatabase,
  createTestRuntimeFromClient,
  executePlanAndCollect,
} from './utils';
import type { DevDatabase } from '@prisma-next/test-utils';
import { Client } from 'pg';
import type { Contract } from './fixtures/generated/contract.d';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../..');

describe('end-to-end query with emitted contract', { timeout: 30000 }, () => {
  const adapterPath = resolve(repoRoot, 'packages/adapter-postgres');
  const cliPath = resolve(repoRoot, 'packages/cli/dist/cli.js');
  const contractTsPath = resolve(__dirname, 'fixtures/contract.ts');
  const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

  it('emits contract and verifies it matches on-disk artifacts', async () => {
    const outputDir = resolve(__dirname, '../.tmp-output');
    await emitAndVerifyContract(cliPath, contractTsPath, adapterPath, outputDir, contractJsonPath);
  });

  it('returns multiple rows with correct types', async () => {
    const contract = await loadContractFromDisk<Contract>(contractJsonPath);

    await withDevDatabase(
      async ({ connectionString }: DevDatabase) => {
        await withClient(connectionString, async (client: Client) => {
          await setupE2EDatabase(client, contract, async (c: Client) => {
            await c.query('drop table if exists "user"');
            await c.query('create table "user" (id serial primary key, email text not null)');
            await c.query('insert into "user" (email) values ($1), ($2), ($3)', [
              'ada@example.com',
              'tess@example.com',
              'mike@example.com',
            ]);
          });

          const adapter = createPostgresAdapter();
          const runtime = createTestRuntimeFromClient(contract, client, adapter);
          try {
            const tables = schema<Contract, CodecTypes>(contract).tables;
            const user = tables['user']!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
              .from(user)
              .select({ id: user.columns['id']!, email: user.columns['email']! })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);

            expect(rows.length).toBeGreaterThan(1);
            expect(rows[0]).toHaveProperty('id');
            expect(rows[0]).toHaveProperty('email');
            expect(typeof rows[0]!.id).toBe('number');
            expect(typeof rows[0]!.email).toBe('string');
          } finally {
            await runtime.close();
          }
        });
      },
      { acceleratePort: 54020, databasePort: 54021, shadowDatabasePort: 54022 },
    );
  });

  it('INNER JOIN returns matching rows', async () => {
    const contract = await loadContractFromDisk<Contract>(contractJsonPath);

    await withDevDatabase(
      async ({ connectionString }: DevDatabase) => {
        await withClient(connectionString, async (client: Client) => {
          await setupE2EDatabase(client, contract, async (c: Client) => {
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
            const user = tables['user']!;
            const post = tables['post']!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
              .from(user)
              .innerJoin(post, (on) => on.eqCol(user.columns['id']!, post.columns['userId']!))
              .select({
                userId: user.columns['id']!,
                email: user.columns['email']!,
                postId: post.columns['id']!,
                title: post.columns['title']!,
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);

            expect(rows.length).toBe(3);
            expect(rows[0]).toHaveProperty('userId');
            expect(rows[0]).toHaveProperty('email');
            expect(rows[0]).toHaveProperty('postId');
            expect(rows[0]).toHaveProperty('title');
            expect(typeof rows[0]!.userId).toBe('number');
            expect(typeof rows[0]!.email).toBe('string');
            expect(typeof rows[0]!.postId).toBe('number');
            expect(typeof rows[0]!.title).toBe('string');

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
  });

  it('LEFT JOIN returns all users including those without posts', async () => {
    const contract = await loadContractFromDisk<Contract>(contractJsonPath);

    await withDevDatabase(
      async ({ connectionString }: DevDatabase) => {
        await withClient(connectionString, async (client: Client) => {
          await setupE2EDatabase(client, contract, async (c: Client) => {
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
            const user = tables['user']!;
            const post = tables['post']!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
              .from(user)
              .leftJoin(post, (on) => on.eqCol(user.columns['id']!, post.columns['userId']!))
              .select({
                userId: user.columns['id']!,
                email: user.columns['email']!,
                postId: post.columns['id']!,
                title: post.columns['title']!,
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);
            type Row = ResultType<typeof plan>;

            expect(rows.length).toBe(3);
            const adaRow = rows.find((r: Row) => r.email === 'ada@example.com');
            const tessRow = rows.find((r: Row) => r.email === 'tess@example.com');
            const mikeRow = rows.find((r: Row) => r.email === 'mike@example.com');

            expect(adaRow).toBeDefined();
            expect(adaRow!.postId).not.toBeNull();
            expect(adaRow!.title).not.toBeNull();

            expect(tessRow).toBeDefined();
            expect(tessRow!.postId).toBeNull();
            expect(tessRow!.title).toBeNull();

            expect(mikeRow).toBeDefined();
            expect(mikeRow!.postId).toBeNull();
            expect(mikeRow!.title).toBeNull();

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
      async ({ connectionString }: DevDatabase) => {
        await withClient(connectionString, async (client: Client) => {
          await setupE2EDatabase(client, contract, async (c: Client) => {
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
            const user = tables['user']!;
            const post = tables['post']!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
              .from(user)
              .rightJoin(post, (on) => on.eqCol(user.columns['id']!, post.columns['userId']!))
              .select({
                userId: user.columns['id']!,
                email: user.columns['email']!,
                postId: post.columns['id']!,
                title: post.columns['title']!,
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);
            type Row = ResultType<typeof plan>;

            expect(rows.length).toBe(2);
            const firstPostRow = rows.find((r: Row) => r.title === 'First Post');
            const orphanPostRow = rows.find((r: Row) => r.title === 'Orphan Post');

            expect(firstPostRow).toBeDefined();
            expect(firstPostRow!.userId).not.toBeNull();
            expect(firstPostRow!.email).not.toBeNull();

            expect(orphanPostRow).toBeDefined();
            expect(orphanPostRow!.userId).toBeNull();
            expect(orphanPostRow!.email).toBeNull();

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
      async ({ connectionString }: DevDatabase) => {
        await withClient(connectionString, async (client: Client) => {
          await setupE2EDatabase(client, contract, async (c: Client) => {
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
            const user = tables['user']!;
            const post = tables['post']!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
              .from(user)
              .fullJoin(post, (on) => on.eqCol(user.columns['id']!, post.columns['userId']!))
              .select({
                userId: user.columns['id']!,
                email: user.columns['email']!,
                postId: post.columns['id']!,
                title: post.columns['title']!,
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);
            type Row = ResultType<typeof plan>;

            expect(rows.length).toBe(3);
            const adaRow = rows.find((r: Row) => r.email === 'ada@example.com');
            const tessRow = rows.find((r: Row) => r.email === 'tess@example.com');
            const orphanRow = rows.find((r: Row) => r.title === 'Orphan Post');

            expect(adaRow).toBeDefined();
            expect(adaRow!.postId).not.toBeNull();

            expect(tessRow).toBeDefined();
            expect(tessRow!.postId).toBeNull();

            expect(orphanRow).toBeDefined();
            expect(orphanRow!.userId).toBeNull();
            expect(orphanRow!.email).toBeNull();

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
      async ({ connectionString }: DevDatabase) => {
        await withClient(connectionString, async (client: Client) => {
          await setupE2EDatabase(client, contract, async (c: Client) => {
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
            const user = tables['user']!;
            const post = tables['post']!;
            const comment = tables['comment']!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
              .from(user)
              .innerJoin(post, (on) => on.eqCol(user.columns['id']!, post.columns['userId']!))
              .leftJoin(comment, (on) => on.eqCol(post.columns['id']!, comment.columns['postId']!))
              .select({
                userId: user.columns['id']!,
                email: user.columns['email']!,
                postId: post.columns['id']!,
                title: post.columns['title']!,
                commentId: comment.columns['id']!,
                content: comment.columns['content']!,
              })
              .build();

            expect(plan.ast?.joins).toBeDefined();
            expect(plan.ast?.joins?.length).toBe(2);
            expect(plan.ast?.joins?.[0]?.joinType).toBe('inner');
            expect(plan.ast?.joins?.[0]?.table.name).toBe('post');
            expect(plan.ast?.joins?.[1]?.joinType).toBe('left');
            expect(plan.ast?.joins?.[1]?.table.name).toBe('comment');

            const rows = await executePlanAndCollect(runtime, plan);
            type Row = ResultType<typeof plan>;

            expect(rows.length).toBe(3);
            const firstPostRow = rows.find(
              (r: Row) => r.title === 'First Post' && r.commentId !== null,
            );
            const secondPostRow = rows.find((r: Row) => r.title === 'Second Post');

            expect(firstPostRow).toBeDefined();
            expect(firstPostRow!.commentId).not.toBeNull();
            expect(firstPostRow!.content).not.toBeNull();

            expect(secondPostRow).toBeDefined();
            expect(secondPostRow!.commentId).toBeNull();
            expect(secondPostRow!.content).toBeNull();

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

  it('nested projection returns flat rows with correct aliases', async () => {
    const contract = await loadContractFromDisk<Contract>(contractJsonPath);

    await withDevDatabase(
      async ({ connectionString }: DevDatabase) => {
        await withClient(connectionString, async (client: Client) => {
          await setupE2EDatabase(client, contract, async (c: Client) => {
            await c.query('drop table if exists "user"');
            await c.query('create table "user" (id serial primary key, email text not null)');
            await c.query('insert into "user" (email) values ($1), ($2), ($3)', [
              'ada@example.com',
              'tess@example.com',
              'mike@example.com',
            ]);
          });

          const adapter = createPostgresAdapter();
          const runtime = createTestRuntimeFromClient(contract, client, adapter);
          try {
            const tables = schema<Contract, CodecTypes>(contract).tables;
            const user = tables['user']!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
              .from(user)
              .select({
                name: user.columns['email']!,
                post: {
                  title: user.columns['id']!,
                },
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);

            expect(rows.length).toBe(3);
            expect(rows[0]).toHaveProperty('name');
            expect(rows[0]).toHaveProperty('post_title');
            expect(rows[0]).not.toHaveProperty('post');

            expect(typeof rows[0]!.name).toBe('string');
            expect(typeof (rows[0] as Record<string, unknown>)['post_title']).toBe('number');

            type Row = ResultType<typeof plan>;
            expectTypeOf<Row>().toExtend<{
              name: string;
              post: { title: number };
            }>();
            expectTypeOf<Row['name']>().toEqualTypeOf<string>();
            expectTypeOf<Row['post']>().toEqualTypeOf<{ title: number }>();
            expectTypeOf<Row['post']['title']>().toEqualTypeOf<number>();

            const flatRow0 = rows[0] as Record<string, unknown>;
            expect(flatRow0['name']).toBe('ada@example.com');
            expect(flatRow0['post_title']).toBe(1);
            expect({ name: flatRow0['name'], post: { title: flatRow0['post_title'] } }).toEqual({
              name: 'ada@example.com',
              post: { title: 1 },
            });

            expect(plan.meta.projection).toEqual({
              name: 'user.email',
              post_title: 'user.id',
            });

            expect(plan.meta.projectionTypes).toEqual({
              name: 'pg/text@1',
              post_title: 'pg/int4@1',
            });
          } finally {
            await runtime.close();
          }
        });
      },
      { acceleratePort: 54080, databasePort: 54081, shadowDatabasePort: 54082 },
    );
  });

  it('multi-level nested projection returns flat rows with correct aliases', async () => {
    const contract = await loadContractFromDisk<Contract>(contractJsonPath);

    await withDevDatabase(
      async ({ connectionString }: DevDatabase) => {
        await withClient(connectionString, async (client: Client) => {
          await setupE2EDatabase(client, contract, async (c: Client) => {
            await c.query('drop table if exists "user"');
            await c.query('create table "user" (id serial primary key, email text not null)');
            await c.query('insert into "user" (email) values ($1), ($2)', [
              'ada@example.com',
              'tess@example.com',
            ]);
          });

          const adapter = createPostgresAdapter();
          const runtime = createTestRuntimeFromClient(contract, client, adapter);
          try {
            const tables = schema<Contract, CodecTypes>(contract).tables;
            const user = tables['user']!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
              .from(user)
              .select({
                a: {
                  b: {
                    c: user.columns['id']!,
                  },
                },
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);

            expect(rows.length).toBe(2);
            expect(rows[0]).toHaveProperty('a_b_c');
            expect(rows[0]).not.toHaveProperty('a');

            expect(typeof (rows[0] as Record<string, unknown>)['a_b_c']).toBe('number');

            type Row = ResultType<typeof plan>;
            expectTypeOf<Row>().toExtend<{
              a: { b: { c: number } };
            }>();
            expectTypeOf<Row['a']>().toEqualTypeOf<{ b: { c: number } }>();
            expectTypeOf<Row['a']['b']>().toEqualTypeOf<{ c: number }>();
            expectTypeOf<Row['a']['b']['c']>().toEqualTypeOf<number>();

            const flatRow0 = rows[0] as Record<string, unknown>;
            expect(flatRow0['a_b_c']).toBe(1);
            expect({ a: { b: { c: flatRow0['a_b_c'] } } }).toEqual({
              a: { b: { c: 1 } },
            });

            const flatRow1 = rows[1] as Record<string, unknown>;
            expect(flatRow1['a_b_c']).toBe(2);
            expect({ a: { b: { c: flatRow1['a_b_c'] } } }).toEqual({
              a: { b: { c: 2 } },
            });

            expect(plan.meta.projection).toEqual({
              a_b_c: 'user.id',
            });
          } finally {
            await runtime.close();
          }
        });
      },
      { acceleratePort: 54090, databasePort: 54091, shadowDatabasePort: 54092 },
    );
  });

  it('nested projection with joins returns flat rows with correct aliases', async () => {
    const contract = await loadContractFromDisk<Contract>(contractJsonPath);

    await withDevDatabase(
      async ({ connectionString }: DevDatabase) => {
        await withClient(connectionString, async (client: Client) => {
          await setupE2EDatabase(client, contract, async (c: Client) => {
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
            await c.query('insert into "post" ("userId", title) values ($1, $2), ($1, $3)', [
              1,
              'First Post',
              'Second Post',
            ]);
          });

          const adapter = createPostgresAdapter();
          const runtime = createTestRuntimeFromClient(contract, client, adapter);
          try {
            const tables = schema<Contract, CodecTypes>(contract).tables;
            const user = tables['user']!;
            const post = tables['post']!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
              .from(user)
              .innerJoin(post, (on) => on.eqCol(user.columns['id']!, post.columns['userId']!))
              .select({
                name: user.columns['email']!,
                post: {
                  title: post.columns['title']!,
                  id: post.columns['id']!,
                },
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);

            expect(rows.length).toBe(2);
            expect(rows[0]).toHaveProperty('name');
            expect(rows[0]).toHaveProperty('post_title');
            expect(rows[0]).toHaveProperty('post_id');
            expect(rows[0]).not.toHaveProperty('post');

            expect(typeof rows[0]!.name).toBe('string');
            expect(typeof (rows[0] as Record<string, unknown>)['post_title']).toBe('string');
            expect(typeof (rows[0] as Record<string, unknown>)['post_id']).toBe('number');

            type Row = ResultType<typeof plan>;
            expectTypeOf<Row>().toExtend<{
              name: string;
              post: { title: string; id: number };
            }>();
            expectTypeOf<Row['name']>().toEqualTypeOf<string>();
            expectTypeOf<Row['post']>().toEqualTypeOf<{ title: string; id: number }>();
            expectTypeOf<Row['post']['title']>().toEqualTypeOf<string>();
            expectTypeOf<Row['post']['id']>().toEqualTypeOf<number>();

            const flatRow0 = rows[0] as Record<string, unknown>;
            expect(flatRow0['name']).toBe('ada@example.com');
            expect(flatRow0['post_title']).toBe('First Post');
            expect(flatRow0['post_id']).toBe(1);
            expect({
              name: flatRow0['name'],
              post: { title: flatRow0['post_title'], id: flatRow0['post_id'] },
            }).toEqual({
              name: 'ada@example.com',
              post: { title: 'First Post', id: 1 },
            });

            expect(plan.meta.projection).toEqual({
              name: 'user.email',
              post_title: 'post.title',
              post_id: 'post.id',
            });

            expect(plan.meta.refs?.tables).toContain('user');
            expect(plan.meta.refs?.tables).toContain('post');
          } finally {
            await runtime.close();
          }
        });
      },
      { acceleratePort: 54100, databasePort: 54101, shadowDatabasePort: 54102 },
    );
  });

  it('mixed leaves and nested objects in projection returns flat rows', async () => {
    const contract = await loadContractFromDisk<Contract>(contractJsonPath);

    await withDevDatabase(
      async ({ connectionString }: DevDatabase) => {
        await withClient(connectionString, async (client: Client) => {
          await setupE2EDatabase(client, contract, async (c: Client) => {
            await c.query('drop table if exists "user"');
            await c.query('create table "user" (id serial primary key, email text not null)');
            await c.query('insert into "user" (email) values ($1), ($2)', [
              'ada@example.com',
              'tess@example.com',
            ]);
          });

          const adapter = createPostgresAdapter();
          const runtime = createTestRuntimeFromClient(contract, client, adapter);
          try {
            const tables = schema<Contract, CodecTypes>(contract).tables;
            const user = tables['user']!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
              .from(user)
              .select({
                id: user.columns['id']!,
                post: {
                  title: user.columns['email']!,
                  author: {
                    name: user.columns['id']!,
                  },
                },
                email: user.columns['email']!,
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);

            expect(rows.length).toBe(2);
            expect(rows[0]).toHaveProperty('id');
            expect(rows[0]).toHaveProperty('post_title');
            expect(rows[0]).toHaveProperty('post_author_name');
            expect(rows[0]).toHaveProperty('email');
            expect(rows[0]).not.toHaveProperty('post');

            expect(typeof rows[0]!.id).toBe('number');
            expect(typeof (rows[0] as Record<string, unknown>)['post_title']).toBe('string');
            expect(typeof (rows[0] as Record<string, unknown>)['post_author_name']).toBe('number');
            expect(typeof rows[0]!.email).toBe('string');

            type Row = ResultType<typeof plan>;
            expectTypeOf<Row>().toExtend<{
              id: number;
              post: { title: string; author: { name: number } };
              email: string;
            }>();
            expectTypeOf<Row['id']>().toEqualTypeOf<number>();
            expectTypeOf<Row['post']>().toEqualTypeOf<{
              title: string;
              author: { name: number };
            }>();
            expectTypeOf<Row['post']['title']>().toEqualTypeOf<string>();
            expectTypeOf<Row['post']['author']>().toEqualTypeOf<{ name: number }>();
            expectTypeOf<Row['post']['author']['name']>().toEqualTypeOf<number>();
            expectTypeOf<Row['email']>().toEqualTypeOf<string>();

            const flatRow0 = rows[0] as Record<string, unknown>;
            expect(flatRow0['id']).toBe(1);
            expect(flatRow0['post_title']).toBe('ada@example.com');
            expect(flatRow0['post_author_name']).toBe(1);
            expect(flatRow0['email']).toBe('ada@example.com');
            expect({
              id: flatRow0['id'],
              post: {
                title: flatRow0['post_title'],
                author: { name: flatRow0['post_author_name'] },
              },
              email: flatRow0['email'],
            }).toEqual({
              id: 1,
              post: { title: 'ada@example.com', author: { name: 1 } },
              email: 'ada@example.com',
            });

            expect(plan.meta.projection).toEqual({
              id: 'user.id',
              post_title: 'user.email',
              post_author_name: 'user.id',
              email: 'user.email',
            });
          } finally {
            await runtime.close();
          }
        });
      },
      { acceleratePort: 54110, databasePort: 54111, shadowDatabasePort: 54112 },
    );
  });
});
