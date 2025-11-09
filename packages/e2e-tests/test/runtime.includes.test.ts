import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { ResultType } from '@prisma-next/contract/types';
import { createRuntimeContext } from '@prisma-next/runtime';
import {
  createTestRuntimeFromClient,
  executePlanAndCollect,
  setupE2EDatabase,
} from '@prisma-next/runtime/test/utils';
import { param } from '@prisma-next/sql-query/param';
import { schema } from '@prisma-next/sql-query/schema';
import { sql } from '@prisma-next/sql-query/sql';
import { type DevDatabase, timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import type { Client } from 'pg';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { loadContractFromDisk } from './utils';

// Extend Contract type with capabilities for includeMany support
type ContractWithCapabilities = Contract & {
  readonly capabilities: {
    readonly postgres: {
      readonly lateral: true;
      readonly jsonAgg: true;
    };
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('end-to-end includeMany and leftJoin queries', () => {
  it(
    'includeMany returns one row per parent with nested array of children',
    async () => {
      const contract = await loadContractFromDisk<ContractWithCapabilities>(contractJsonPath);

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
                [1, 'Ada Post 1', 'Ada Post 2', 2, 'Tess Post 1'],
              );
            });

            const adapter = createPostgresAdapter();
            const context = createRuntimeContext({ contract, adapter, extensions: [] });
            const runtime = createTestRuntimeFromClient(contract, client, adapter);
            try {
              const tables = schema<ContractWithCapabilities>(context).tables;
              const user = tables['user']!;
              const post = tables['post']!;
              const plan = sql({
                context,
              })
                .from(user)
                .includeMany(
                  post,
                  (on) => on.eqCol(user.columns['id']!, post.columns['userId']!),
                  (child) =>
                    child.select({
                      id: post.columns['id']!,
                      title: post.columns['title']!,
                    }),
                  { alias: 'posts' },
                )
                .select({
                  id: user.columns['id']!,
                  email: user.columns['email']!,
                  posts: true,
                })
                .build();

              const rows = await executePlanAndCollect(runtime, plan);
              type Row = ResultType<typeof plan>;

              expect(rows.length).toBe(3);

              const adaRow = rows.find((r: Row) => r.email === 'ada@example.com');
              expect(adaRow).toMatchObject({
                email: 'ada@example.com',
                posts: [
                  { id: 1, title: 'Ada Post 1' },
                  { id: 2, title: 'Ada Post 2' },
                ],
              });

              const tessRow = rows.find((r: Row) => r.email === 'tess@example.com');
              expect(tessRow).toMatchObject({
                email: 'tess@example.com',
                posts: [{ id: 3, title: 'Tess Post 1' }],
              });

              const mikeRow = rows.find((r: Row) => r.email === 'mike@example.com');
              expect(mikeRow).toMatchObject({
                email: 'mike@example.com',
                posts: [],
              });

              expectTypeOf<Row['posts']>().toEqualTypeOf<Array<{ id: number; title: string }>>();
            } finally {
              await runtime.close();
            }
          });
        },
        { acceleratePort: 54050, databasePort: 54051, shadowDatabasePort: 54052 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it('includeMany with child where, orderBy, and limit filters children', async () => {
    const contract = await loadContractFromDisk<ContractWithCapabilities>(contractJsonPath);

    await withDevDatabase(
      async ({ connectionString }: DevDatabase) => {
        await withClient(connectionString, async (client: Client) => {
          await setupE2EDatabase(client, contract, async (c: Client) => {
            await c.query('drop table if exists "comment"');
            await c.query('drop table if exists "post"');
            await c.query('drop table if exists "user"');
            await c.query('create table "user" (id serial primary key, email text not null)');
            await c.query(
              'create table "post" (id serial primary key, "userId" int4 not null, title text not null, published boolean not null default false)',
            );
            await c.query('insert into "user" (email) values ($1)', ['ada@example.com']);
            await c.query(
              'insert into "post" ("userId", title, published) values ($1, $2, $3), ($1, $4, $5), ($1, $6, $7)',
              [1, 'Published Post 1', true, 'Unpublished Post', false, 'Published Post 2', true],
            );
          });

          const adapter = createPostgresAdapter();
          const context = createRuntimeContext({ contract, adapter, extensions: [] });
          const runtime = createTestRuntimeFromClient(contract, client, adapter);
          try {
            const tables = schema<ContractWithCapabilities>(context).tables;
            const user = tables['user']!;
            const post = tables['post']!;
            const plan = sql({
              context,
            })
              .from(user)
              .includeMany(
                post,
                (on) => on.eqCol(user.columns['id']!, post.columns['userId']!),
                (child) =>
                  child
                    .select({
                      id: post.columns['id']!,
                      title: post.columns['title']!,
                    })
                    .where(post.columns['published']!.eq(param('published')))
                    .orderBy(post.columns['id']!.asc())
                    .limit(1),
                { alias: 'posts' },
              )
              .select({
                id: user.columns['id']!,
                email: user.columns['email']!,
                posts: true,
              })
              .build({ params: { published: true } });

            const rows = await executePlanAndCollect(runtime, plan);

            expect(rows.length).toBe(1);
            expect(rows[0]).toMatchObject({
              posts: [{ title: 'Published Post 1' }],
            });
          } finally {
            await runtime.close();
          }
        });
      },
      { acceleratePort: 54060, databasePort: 54061, shadowDatabasePort: 54062 },
    );
  }, timeouts.spinUpPpgDev);

  it('leftJoin returns one row per child with parent data (many-to-one)', async () => {
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
            await c.query(
              'insert into "post" ("userId", title) values ($1, $2), ($1, $3), ($4, $5)',
              [1, 'Ada Post 1', 'Ada Post 2', 2, 'Tess Post 1'],
            );
          });

          const adapter = createPostgresAdapter();
          const context = createRuntimeContext({ contract, adapter, extensions: [] });
          const runtime = createTestRuntimeFromClient(contract, client, adapter);
          try {
            const tables = schema<Contract>(context).tables;
            const user = tables['user']!;
            const post = tables['post']!;
            const plan = sql({ context })
              .from(post)
              .leftJoin(user, (on) => on.eqCol(post.columns['userId']!, user.columns['id']!))
              .select({
                postId: post.columns['id']!,
                postTitle: post.columns['title']!,
                userId: user.columns['id']!,
                userEmail: user.columns['email']!,
              })
              .build();

            const rows = await executePlanAndCollect(runtime, plan);
            type Row = ResultType<typeof plan>;

            expect(rows.length).toBe(3);

            const adaPost1 = rows.find((r: Row) => r.postTitle === 'Ada Post 1');
            expect(adaPost1).toMatchObject({
              postTitle: 'Ada Post 1',
              userId: 1,
              userEmail: 'ada@example.com',
            });

            const adaPost2 = rows.find((r: Row) => r.postTitle === 'Ada Post 2');
            expect(adaPost2).toMatchObject({
              postTitle: 'Ada Post 2',
              userId: 1,
              userEmail: 'ada@example.com',
            });

            const tessPost1 = rows.find((r: Row) => r.postTitle === 'Tess Post 1');
            expect(tessPost1).toMatchObject({
              postTitle: 'Tess Post 1',
              userId: 2,
              userEmail: 'tess@example.com',
            });
          } finally {
            await runtime.close();
          }
        });
      },
      { acceleratePort: 54070, databasePort: 54071, shadowDatabasePort: 54072 },
    );
  }, timeouts.spinUpPpgDev);

  it('leftJoin with where filters parent data (many-to-one with filter)', async () => {
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
            await c.query(
              'insert into "post" ("userId", title) values ($1, $2), ($1, $3), ($4, $5)',
              [1, 'Ada Post 1', 'Ada Post 2', 2, 'Tess Post 1'],
            );
          });

          const adapter = createPostgresAdapter();
          const context = createRuntimeContext({ contract, adapter, extensions: [] });
          const runtime = createTestRuntimeFromClient(contract, client, adapter);
          try {
            const tables = schema<Contract>(context).tables;
            const user = tables['user']!;
            const post = tables['post']!;
            const plan = sql({ context })
              .from(post)
              .leftJoin(user, (on) => on.eqCol(post.columns['userId']!, user.columns['id']!))
              .where(user.columns['email']!.eq(param('email')))
              .select({
                postId: post.columns['id']!,
                postTitle: post.columns['title']!,
                userId: user.columns['id']!,
                userEmail: user.columns['email']!,
              })
              .build({ params: { email: 'ada@example.com' } });

            const rows = await executePlanAndCollect(runtime, plan);

            expect(rows.length).toBe(2);
            expect(rows[0]).toMatchObject({
              postId: expect.any(Number),
              postTitle: expect.any(String),
              userId: expect.any(Number),
              userEmail: 'ada@example.com',
            });
            expect(rows[1]).toMatchObject({
              userEmail: 'ada@example.com',
            });

            expect(plan.meta.refs?.tables).toContain('user');
            expect(plan.meta.refs?.tables).toContain('post');
          } finally {
            await runtime.close();
          }
        });
      },
      { acceleratePort: 54080, databasePort: 54081, shadowDatabasePort: 54082 },
    );
  }, timeouts.spinUpPpgDev);
});
