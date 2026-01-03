import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { createPrismaNextControlClient } from '@prisma-next/cli/control-api';
import postgresDriver from '@prisma-next/driver-postgres/control';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres/runtime';
import pgvectorControl from '@prisma-next/extension-pgvector/control';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import sql from '@prisma-next/family-sql/control';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { IncludeChildBuilder, JoinOnBuilder } from '@prisma-next/sql-lane';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { budgets, createRuntime, createRuntimeContext } from '@prisma-next/sql-runtime';
import postgres from '@prisma-next/target-postgres/control';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import type { Client } from 'pg';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

// Load the already-emitted contract
const contract = validateContract<Contract>(contractJson);

/**
 * Sign the database marker using the control-api client.
 * Assumes tables are already created.
 */
async function signDatabaseMarker(connectionString: string) {
  const controlClient = createPrismaNextControlClient({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: [pgvectorControl],
  } as Parameters<typeof createPrismaNextControlClient>[0]);

  await controlClient.connect(connectionString);
  const result = await controlClient.sign({
    contractIR: contract as Parameters<typeof controlClient.sign>[0]['contractIR'],
  });
  await controlClient.close();
  return result;
}

describe('runtime execute integration', () => {
  it(
    'streams rows and enforces marker verification',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        // Create tables manually with proper defaults (SERIAL, DEFAULT NOW())
        await withClient(connectionString, async (client: Client) => {
          await client.query(
            'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
          );
          await client.query(
            'create table if not exists "post" (id serial primary key, title text not null, "userId" int4 not null, "createdAt" timestamptz not null default now(), constraint post_userId_fkey foreign key ("userId") references "user"(id))',
          );
          await client.query('truncate table "post", "user" restart identity cascade');
          await client.query('insert into "user" (email) values ($1)', ['alice@example.com']);
        });

        // Sign the database marker using control-api
        await signDatabaseMarker(connectionString);

        const adapter = createPostgresAdapter();
        const context = createRuntimeContext({ contract, adapter, extensions: [pgvector()] });
        const tables = schema(context).tables;
        const userTable = tables['user']!;
        const root = sqlBuilder({ context });
        const plan = root
          .from(userTable)
          .select({
            id: userTable.columns['id']!,
            email: userTable.columns['email']!,
          })
          .limit(10)
          .build();

        const templatePlan = root.raw.with({ annotations: { limit: 1 } })`
          select id, email from "user"
          where email = ${'alice@example.com'}
          limit ${1}
        `;

        const functionPlan = root.raw('select id from "user" where email = $1 limit $2', {
          params: ['alice@example.com', 1],
          refs: { tables: ['user'], columns: [{ table: 'user', column: 'email' }] },
          annotations: { intent: 'report', limit: 1 },
        });

        const pool = new Pool({ connectionString });
        const driver = createPostgresDriverFromOptions({
          connect: { pool },
          cursor: { disabled: true },
        });
        const runtime = createRuntime({
          context,
          adapter,
          driver,
          verify: { mode: 'onFirstUse', requireMarker: true }, // Marker verification enabled!
          plugins: [
            budgets({
              maxRows: 10_000,
              defaultTableRows: 10_000,
              tableRows: { user: 10_000, post: 10_000 },
            }),
          ],
        });

        try {
          type PlanRow = ResultType<typeof plan>;
          const rows: PlanRow[] = [];
          for await (const row of runtime.execute(plan)) {
            rows.push(row as PlanRow);
          }

          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({ email: 'alice@example.com' });

          type TemplatePlanRow = ResultType<typeof templatePlan>;
          const templateRows: TemplatePlanRow[] = [];
          for await (const row of runtime.execute(templatePlan)) {
            templateRows.push(row);
          }
          expect(templateRows).toHaveLength(1);

          type FunctionPlanRow = ResultType<typeof functionPlan>;
          const functionRows: FunctionPlanRow[] = [];
          for await (const row of runtime.execute(functionPlan)) {
            functionRows.push(row);
          }
          expect(functionRows).toHaveLength(1);
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'infers correct types from query plans',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        // Create tables manually with proper defaults
        await withClient(connectionString, async (client: Client) => {
          await client.query(
            'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
          );
          await client.query(
            'create table if not exists "post" (id serial primary key, title text not null, "userId" int4 not null, "createdAt" timestamptz not null default now(), constraint post_userId_fkey foreign key ("userId") references "user"(id))',
          );
          await client.query('truncate table "post", "user" restart identity cascade');
          await client.query('insert into "user" (email) values ($1)', ['alice@example.com']);
          await client.query('insert into "post" (title, "userId") values ($1, $2)', [
            'First Post',
            1,
          ]);
        });

        // Sign the database marker using control-api
        await signDatabaseMarker(connectionString);

        const adapter = createPostgresAdapter();
        const pool = new Pool({ connectionString });
        const driver = createPostgresDriverFromOptions({
          connect: { pool },
          cursor: { disabled: true },
        });
        const context = createRuntimeContext({ contract, adapter, extensions: [pgvector()] });
        const runtime = createRuntime({
          context,
          adapter,
          driver,
          verify: { mode: 'onFirstUse', requireMarker: true },
          plugins: [
            budgets({
              maxRows: 10_000,
              defaultTableRows: 10_000,
              tableRows: { user: 10_000, post: 10_000 },
            }),
          ],
        });

        try {
          const tables = schema(context).tables;
          const userTable = tables['user']!;
          const postTable = tables['post']!;

          const userPlan = sqlBuilder({ context })
            .from(userTable)
            .select({
              id: userTable.columns['id']!,
              email: userTable.columns['email']!,
              createdAt: userTable.columns['createdAt']!,
            })
            .limit(10)
            .build();

          type UserRow = ResultType<typeof userPlan>;

          const postPlan = sqlBuilder({ context })
            .from(postTable)
            .where(postTable.columns['userId']!.eq(param('userId')))
            .select({
              id: postTable.columns['id']!,
              title: postTable.columns['title']!,
              userId: postTable.columns['userId']!,
              createdAt: postTable.columns['createdAt']!,
            })
            .limit(1)
            .build({ params: { userId: 1 } });

          type PostRow = ResultType<typeof postPlan>;

          const userRows: UserRow[] = [];
          for await (const row of runtime.execute(userPlan)) {
            userRows.push(row as UserRow);
          }
          expect(userRows).toHaveLength(1);
          expect(userRows[0]).toMatchObject({ email: 'alice@example.com' });

          const postRows: PostRow[] = [];
          for await (const row of runtime.execute(postPlan)) {
            postRows.push(row as PostRow);
          }
          expect(postRows).toHaveLength(1);
          expect(postRows[0]).toMatchObject({ title: 'First Post', userId: 1 });
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'enforces row budget on unbounded queries',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        // Create tables manually with proper defaults
        await withClient(connectionString, async (client: Client) => {
          await client.query(
            'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
          );
          await client.query('truncate table "user" restart identity cascade');
          for (let i = 0; i < 100; i++) {
            await client.query('insert into "user" (email) values ($1)', [`user${i}@example.com`]);
          }
        });

        // Sign the database marker using control-api
        await signDatabaseMarker(connectionString);

        const adapter = createPostgresAdapter();
        const pool = new Pool({ connectionString });
        const driver = createPostgresDriverFromOptions({
          connect: { pool },
          cursor: { disabled: true },
        });
        const context = createRuntimeContext({ contract, adapter, extensions: [pgvector()] });
        const runtime = createRuntime({
          context,
          adapter,
          driver,
          verify: { mode: 'onFirstUse', requireMarker: true },
          plugins: [
            budgets({
              maxRows: 50,
              defaultTableRows: 10_000,
              tableRows: { user: 10_000, post: 10_000 },
            }),
          ],
        });

        try {
          const tables = schema(context).tables;
          const userTable = tables['user']!;
          const unboundedPlan = sqlBuilder({ context })
            .from(tables['user']!)
            .select({
              id: userTable.columns['id']!,
              email: userTable.columns['email']!,
            })
            .build();

          await expect(async () => {
            for await (const _row of runtime.execute(unboundedPlan)) {
              // Should not reach here
            }
          }).rejects.toMatchObject({
            code: 'BUDGET.ROWS_EXCEEDED',
            category: 'BUDGET',
          });

          const boundedPlan = sqlBuilder({ context })
            .from(tables['user']!)
            .select({
              id: userTable.columns['id']!,
              email: userTable.columns['email']!,
            })
            .limit(10)
            .build();

          type BoundedPlanRow = ResultType<typeof boundedPlan>;
          const rows: BoundedPlanRow[] = [];
          for await (const row of runtime.execute(boundedPlan)) {
            rows.push(row);
          }
          expect(rows.length).toBeLessThanOrEqual(10);
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'enforces streaming row budget',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        // Create tables manually with proper defaults
        await withClient(connectionString, async (client: Client) => {
          await client.query(
            'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
          );
          await client.query('truncate table "user" restart identity cascade');
          for (let i = 0; i < 50; i++) {
            await client.query('insert into "user" (email) values ($1)', [`user${i}@example.com`]);
          }
        });

        // Sign the database marker using control-api
        await signDatabaseMarker(connectionString);

        const adapter = createPostgresAdapter();
        const pool = new Pool({ connectionString });
        const driver = createPostgresDriverFromOptions({
          connect: { pool },
          cursor: { disabled: true },
        });
        const context = createRuntimeContext({ contract, adapter, extensions: [pgvector()] });
        const runtime = createRuntime({
          context,
          adapter,
          driver,
          verify: { mode: 'onFirstUse', requireMarker: true },
          plugins: [
            budgets({
              maxRows: 10,
              defaultTableRows: 10_000,
              tableRows: { user: 10_000, post: 10_000 },
            }),
          ],
        });

        try {
          const tables = schema(context).tables;
          const userTable = tables['user']!;
          const plan = sqlBuilder({ context })
            .from(tables['user']!)
            .select({
              id: userTable.columns['id']!,
              email: userTable.columns['email']!,
            })
            .limit(50)
            .build();

          await expect(async () => {
            for await (const _row of runtime.execute(plan)) {
              // Will throw on 11th row
            }
          }).rejects.toMatchObject({
            code: 'BUDGET.ROWS_EXCEEDED',
            category: 'BUDGET',
          });
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'includeMany returns users with nested posts array',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        // Create tables manually with proper defaults
        await withClient(connectionString, async (client) => {
          await client.query(
            'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
          );
          await client.query(
            'create table if not exists "post" (id serial primary key, title text not null, "userId" int4 not null, "createdAt" timestamptz not null default now(), constraint post_userId_fkey foreign key ("userId") references "user"(id))',
          );
          await client.query('truncate table "post", "user" restart identity cascade');
          await client.query('insert into "user" (email) values ($1), ($2)', [
            'alice@example.com',
            'bob@example.com',
          ]);
          await client.query(
            'insert into "post" (title, "userId") values ($1, $2), ($3, $2), ($4, $5)',
            ['First Post', 1, 'Second Post', 'Third Post', 2],
          );
        });

        // Sign the database marker using control-api
        await signDatabaseMarker(connectionString);

        const adapter = createPostgresAdapter();
        const pool = new Pool({ connectionString });
        const driver = createPostgresDriverFromOptions({
          connect: { pool },
          cursor: { disabled: true },
        });
        const context = createRuntimeContext({ contract, adapter, extensions: [pgvector()] });
        const runtime = createRuntime({
          context,
          adapter,
          driver,
          verify: { mode: 'onFirstUse', requireMarker: true },
          plugins: [
            budgets({
              maxRows: 10_000,
              defaultTableRows: 10_000,
              tableRows: { user: 10_000, post: 10_000 },
            }),
          ],
        });

        try {
          const tables = schema(context).tables;
          const userTable = tables['user']!;
          const postTable = tables['post']!;

          const plan = sqlBuilder({ context })
            .from(userTable)
            .includeMany(
              postTable,
              (on: JoinOnBuilder) =>
                on.eqCol(userTable.columns['id']!, postTable.columns['userId']!),
              (child: IncludeChildBuilder) =>
                child
                  .select({
                    id: postTable.columns['id']!,
                    title: postTable.columns['title']!,
                    createdAt: postTable.columns['createdAt']!,
                  })
                  .orderBy(postTable.columns['createdAt']!.desc()),
              { alias: 'posts' },
            )
            .select({
              id: userTable.columns['id']!,
              email: userTable.columns['email']!,
              createdAt: userTable.columns['createdAt']!,
              posts: true,
            })
            .limit(10)
            .build();

          type Row = ResultType<typeof plan>;
          const rows: Row[] = [];
          for await (const row of runtime.execute(plan)) {
            rows.push(row);
          }

          expect(rows).toHaveLength(2);
          expect(rows[0]).toHaveProperty('id');
          expect(rows[0]).toHaveProperty('email');
          expect(rows[0]).toHaveProperty('posts');
          expect(Array.isArray(rows[0]!.posts)).toBe(true);

          const alice = rows.find((r) => r.email === 'alice@example.com');
          expect(alice).toBeDefined();
          expect(alice!.posts).toHaveLength(2);
          expect(alice!.posts[0]).toHaveProperty('id');
          expect(alice!.posts[0]).toHaveProperty('title');
          expect(alice!.posts[0]).toHaveProperty('createdAt');
          expect(typeof alice!.posts[0]!.id).toBe('number');
          expect(typeof alice!.posts[0]!.title).toBe('string');

          const bob = rows.find((r) => r.email === 'bob@example.com');
          expect(bob).toBeDefined();
          expect(bob!.posts).toHaveLength(1);
          expect(bob!.posts[0]!.title).toBe('Third Post');
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );
});
