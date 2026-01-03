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
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import type { Client } from 'pg';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

// Load the already-emitted contract
const contract = validateContract<Contract>(contractJson);

describe('runtime execute integration', () => {
  let database: DevDatabase;
  let connectionString: string;
  let pool: Pool | undefined;
  let runtime: ReturnType<typeof createRuntime> | undefined;

  /**
   * Sign the database marker using the control-api client.
   */
  async function signDatabaseMarker() {
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

  /**
   * Setup database tables.
   */
  async function setupTables() {
    await withClient(connectionString, async (client: Client) => {
      await client.query(
        'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
      );
      await client.query(
        'create table if not exists "post" (id serial primary key, title text not null, "userId" int4 not null, "createdAt" timestamptz not null default now(), constraint post_userId_fkey foreign key ("userId") references "user"(id))',
      );
      await client.query('truncate table "post", "user" restart identity cascade');
    });
  }

  /**
   * Create runtime with specified budget config.
   */
  function createTestRuntime(budgetConfig: { maxRows?: number } = {}) {
    const adapter = createPostgresAdapter();
    pool = new Pool({ connectionString });
    const driver = createPostgresDriverFromOptions({
      connect: { pool },
      cursor: { disabled: true },
    });
    const context = createRuntimeContext({ contract, adapter, extensions: [pgvector()] });
    runtime = createRuntime({
      context,
      adapter,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: true },
      plugins: [
        budgets({
          maxRows: budgetConfig.maxRows ?? 10_000,
          defaultTableRows: 10_000,
          tableRows: { user: 10_000, post: 10_000 },
        }),
      ],
    });
    const tables = schema(context).tables;
    const sql = sqlBuilder({ context });
    return { runtime, context, tables, sql };
  }

  /**
   * Execute a plan and drain results (for inserts/updates/deletes).
   */
  async function executePlan(plan: Parameters<NonNullable<typeof runtime>['execute']>[0]) {
    for await (const _ of runtime!.execute(plan)) {
      // drain
    }
  }

  beforeEach(async () => {
    database = await createDevDatabase();
    connectionString = database.connectionString;
    await setupTables();
    await signDatabaseMarker();
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (runtime) {
      await runtime.close();
      runtime = undefined;
    }
    if (pool && !(pool as { ended?: boolean }).ended) {
      await pool.end();
      pool = undefined;
    }
    await database?.close();
  });

  it(
    'streams rows and enforces marker verification',
    async () => {
      const { tables, sql: root } = createTestRuntime();
      const userTable = tables['user']!;

      // Insert test data
      await executePlan(
        root
          .insert(userTable, { email: param('email') })
          .build({ params: { email: 'alice@example.com' } }),
      );

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

      type PlanRow = ResultType<typeof plan>;
      const rows: PlanRow[] = [];
      for await (const row of runtime!.execute(plan)) {
        rows.push(row as PlanRow);
      }

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ email: 'alice@example.com' });

      type TemplatePlanRow = ResultType<typeof templatePlan>;
      const templateRows: TemplatePlanRow[] = [];
      for await (const row of runtime!.execute(templatePlan)) {
        templateRows.push(row);
      }
      expect(templateRows).toHaveLength(1);

      type FunctionPlanRow = ResultType<typeof functionPlan>;
      const functionRows: FunctionPlanRow[] = [];
      for await (const row of runtime!.execute(functionPlan)) {
        functionRows.push(row);
      }
      expect(functionRows).toHaveLength(1);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'infers correct types from query plans',
    async () => {
      const { tables, sql } = createTestRuntime();
      const userTable = tables['user']!;
      const postTable = tables['post']!;

      await executePlan(
        sql
          .insert(userTable, { email: param('email') })
          .build({ params: { email: 'alice@example.com' } }),
      );
      await executePlan(
        sql
          .insert(postTable, { title: param('title'), userId: param('userId') })
          .build({ params: { title: 'First Post', userId: 1 } }),
      );

      const userPlan = sql
        .from(userTable)
        .select({
          id: userTable.columns['id']!,
          email: userTable.columns['email']!,
          createdAt: userTable.columns['createdAt']!,
        })
        .limit(10)
        .build();

      type UserRow = ResultType<typeof userPlan>;

      const postPlan = sql
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
      for await (const row of runtime!.execute(userPlan)) {
        userRows.push(row as UserRow);
      }
      expect(userRows).toHaveLength(1);
      expect(userRows[0]).toMatchObject({ email: 'alice@example.com' });

      const postRows: PostRow[] = [];
      for await (const row of runtime!.execute(postPlan)) {
        postRows.push(row as PostRow);
      }
      expect(postRows).toHaveLength(1);
      expect(postRows[0]).toMatchObject({ title: 'First Post', userId: 1 });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'enforces row budget on unbounded queries',
    async () => {
      // First, insert data with the default budget
      const { tables, sql: insertSql } = createTestRuntime();
      const userTable = tables['user']!;

      // Insert 100 users
      for (let i = 0; i < 100; i++) {
        await executePlan(
          insertSql
            .insert(userTable, { email: param('email') })
            .build({ params: { email: `user${i}@example.com` } }),
        );
      }

      // Close the first runtime and create one with a lower budget
      await runtime!.close();
      pool = undefined;
      runtime = undefined;

      const { sql } = createTestRuntime({ maxRows: 50 });

      const unboundedPlan = sql
        .from(tables['user']!)
        .select({
          id: userTable.columns['id']!,
          email: userTable.columns['email']!,
        })
        .build();

      await expect(async () => {
        for await (const _row of runtime!.execute(unboundedPlan)) {
          // Should not reach here
        }
      }).rejects.toMatchObject({
        code: 'BUDGET.ROWS_EXCEEDED',
        category: 'BUDGET',
      });

      const boundedPlan = sql
        .from(tables['user']!)
        .select({
          id: userTable.columns['id']!,
          email: userTable.columns['email']!,
        })
        .limit(10)
        .build();

      type BoundedPlanRow = ResultType<typeof boundedPlan>;
      const rows: BoundedPlanRow[] = [];
      for await (const row of runtime!.execute(boundedPlan)) {
        rows.push(row);
      }
      expect(rows.length).toBeLessThanOrEqual(10);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'enforces streaming row budget',
    async () => {
      // First, insert data with the default budget
      const { tables, sql: insertSql } = createTestRuntime();
      const userTable = tables['user']!;

      // Insert 50 users
      for (let i = 0; i < 50; i++) {
        await executePlan(
          insertSql
            .insert(userTable, { email: param('email') })
            .build({ params: { email: `user${i}@example.com` } }),
        );
      }

      // Close the first runtime and create one with a lower budget
      await runtime!.close();
      pool = undefined;
      runtime = undefined;

      const { sql } = createTestRuntime({ maxRows: 10 });

      const plan = sql
        .from(tables['user']!)
        .select({
          id: userTable.columns['id']!,
          email: userTable.columns['email']!,
        })
        .limit(50)
        .build();

      await expect(async () => {
        for await (const _row of runtime!.execute(plan)) {
          // Will throw on 11th row
        }
      }).rejects.toMatchObject({
        code: 'BUDGET.ROWS_EXCEEDED',
        category: 'BUDGET',
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'includeMany returns users with nested posts array',
    async () => {
      const { tables, sql } = createTestRuntime();
      const userTable = tables['user']!;
      const postTable = tables['post']!;

      // Insert test data
      await executePlan(
        sql
          .insert(userTable, { email: param('email') })
          .build({ params: { email: 'alice@example.com' } }),
      );
      await executePlan(
        sql
          .insert(userTable, { email: param('email') })
          .build({ params: { email: 'bob@example.com' } }),
      );
      await executePlan(
        sql
          .insert(postTable, { title: param('title'), userId: param('userId') })
          .build({ params: { title: 'First Post', userId: 1 } }),
      );
      await executePlan(
        sql
          .insert(postTable, { title: param('title'), userId: param('userId') })
          .build({ params: { title: 'Second Post', userId: 1 } }),
      );
      await executePlan(
        sql
          .insert(postTable, { title: param('title'), userId: param('userId') })
          .build({ params: { title: 'Third Post', userId: 2 } }),
      );

      const plan = sql
        .from(userTable)
        .includeMany(
          postTable,
          (on: JoinOnBuilder) => on.eqCol(userTable.columns['id']!, postTable.columns['userId']!),
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
      for await (const row of runtime!.execute(plan)) {
        rows.push(row);
      }

      expect(rows).toHaveLength(2);

      const alice = rows.find((r) => r.email === 'alice@example.com');
      expect(alice).toMatchObject({
        id: 1,
        email: 'alice@example.com',
        createdAt: expect.any(String),
        posts: expect.arrayContaining([
          { id: expect.any(Number), title: 'First Post', createdAt: expect.any(String) },
          { id: expect.any(Number), title: 'Second Post', createdAt: expect.any(String) },
        ]),
      });
      expect(alice!.posts).toHaveLength(2);

      const bob = rows.find((r) => r.email === 'bob@example.com');
      expect(bob).toMatchObject({
        id: 2,
        email: 'bob@example.com',
        createdAt: expect.any(String),
        posts: [{ id: expect.any(Number), title: 'Third Post', createdAt: expect.any(String) }],
      });
    },
    timeouts.spinUpPpgDev,
  );
});
