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
import type { ResultType } from '@prisma-next/sql-query/types';
import { type DevDatabase, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { loadContractFromDisk } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('end-to-end nested projection queries', { timeout: 30000 }, () => {
  it('nested projection returns flat rows with correct aliases', async () => {
    const contract = await loadContractFromDisk<Contract>(contractJsonPath);

    await withDevDatabase(
      async ({ connectionString }: { connectionString: string }) => {
        await withClient(connectionString, async (client: import('pg').Client) => {
          await setupE2EDatabase(client, contract, async (c: typeof client) => {
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
            const user = tables.user!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
              .from(user)
              .select({
                name: user.columns.email!,
                post: {
                  title: user.columns.id!,
                },
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);

            expect(rows.length).toBe(3);
            expect(rows[0]).toMatchObject({
              name: expect.any(String),
              post_title: expect.any(Number),
            });
            expect(rows[0]).toEqual(expect.not.objectContaining({ post: expect.anything() }));

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
            expect({
              name: flatRow0['name'],
              post: { title: flatRow0['post_title'] },
            }).toEqual({
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
      async ({ connectionString }: { connectionString: string }) => {
        await withClient(connectionString, async (client: import('pg').Client) => {
          await setupE2EDatabase(client, contract, async (c: typeof client) => {
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
            const user = tables.user!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
              .from(user)
              .select({
                a: {
                  b: {
                    c: user.columns.id!,
                  },
                },
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);

            expect(rows.length).toBe(2);
            expect(rows[0]).toMatchObject({
              a_b_c: expect.any(Number),
            });
            expect(rows[0]).toEqual(expect.not.objectContaining({ a: expect.anything() }));

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
      async ({ connectionString }: { connectionString: string }) => {
        await withClient(connectionString, async (client: import('pg').Client) => {
          await setupE2EDatabase(client, contract, async (c: typeof client) => {
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
            const user = tables.user!;
            const post = tables.post!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
              .from(user)
              .innerJoin(post, (on) => on.eqCol(user.columns.id!, post.columns.userId!))
              .select({
                name: user.columns.email!,
                post: {
                  title: post.columns.title!,
                  id: post.columns.id!,
                },
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);

            expect(rows.length).toBe(2);
            expect(rows[0]).toMatchObject({
              name: expect.any(String),
              post_title: expect.any(String),
              post_id: expect.any(Number),
            });
            expect(rows[0]).toEqual(expect.not.objectContaining({ post: expect.anything() }));

            type Row = ResultType<typeof plan>;
            expectTypeOf<Row>().toExtend<{
              name: string;
              post: { title: string; id: number };
            }>();
            expectTypeOf<Row['name']>().toEqualTypeOf<string>();
            expectTypeOf<Row['post']>().toEqualTypeOf<{
              title: string;
              id: number;
            }>();
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
      async ({ connectionString }: { connectionString: string }) => {
        await withClient(connectionString, async (client: import('pg').Client) => {
          await setupE2EDatabase(client, contract, async (c: typeof client) => {
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
            const user = tables.user!;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
              .from(user)
              .select({
                id: user.columns.id!,
                post: {
                  title: user.columns.email!,
                  author: {
                    name: user.columns.id!,
                  },
                },
                email: user.columns.email!,
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);

            expect(rows.length).toBe(2);
            expect(rows[0]).toMatchObject({
              id: expect.any(Number),
              post_title: expect.any(String),
              post_author_name: expect.any(Number),
              email: expect.any(String),
            });
            expect(rows[0]).toEqual(expect.not.objectContaining({ post: expect.anything() }));

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
            expectTypeOf<Row['post']['author']>().toEqualTypeOf<{
              name: number;
            }>();
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
