import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { loadContractFromTs } from '@prisma-next/cli';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';
import { emit, loadExtensionPacks } from '@prisma-next/emitter';
import { budgets, createRuntime } from '@prisma-next/runtime';
import { param } from '@prisma-next/sql-query/param';
import { schema } from '@prisma-next/sql-query/schema';
import { validateContract } from '@prisma-next/sql-query/schema';
import { sql } from '@prisma-next/sql-query/sql';
import type { ResultType } from '@prisma-next/sql-query/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-target';
import { withClient, withDevDatabase } from '@prisma-next/test-utils';
import { Pool } from 'pg';

import type { Contract } from '../src/prisma/contract.d';
import { stampMarker } from '../src/prisma/scripts/stamp-marker';

let contract: ReturnType<typeof validateContract>;

beforeAll(async () => {
  const contractPath = resolve(__dirname, '../prisma/contract.ts');
  const outputDir = resolve(__dirname, '../src/prisma');
  const adapterPath = resolve(__dirname, '../../../packages/adapter-postgres');

  const contractIR = await loadContractFromTs(contractPath);
  const packs = loadExtensionPacks(adapterPath, []);

  const result = await emit(
    contractIR,
    {
      outputDir,
      packs,
    },
    sqlTargetFamilyHook,
  );

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'contract.json'), result.contractJson, 'utf-8');
  writeFileSync(join(outputDir, 'contract.d.ts'), result.contractDts, 'utf-8');

  const contractJson = JSON.parse(result.contractJson);
  contract = validateContract<Contract>(contractJson);
});

describe('runtime execute integration', () => {
  it('streams rows and enforces marker verification', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      const adapter = createPostgresAdapter();
      const pool = new Pool({ connectionString });
      const driver = createPostgresDriverFromOptions({
        connect: { pool },
        cursor: { disabled: true },
      });
      const runtime = createRuntime({
        contract,
        adapter,
        driver,
        verify: { mode: 'always', requireMarker: true },
        plugins: [
          budgets({
            maxRows: 10_000,
            defaultTableRows: 10_000,
            tableRows: { user: 10_000, post: 10_000 },
          }),
        ],
      });

      try {
        await stampMarker({
          connectionString,
          coreHash: contract.coreHash,
          profileHash: contract.profileHash ?? contract.coreHash,
        });

        await withClient(connectionString, async (client) => {
          await client.query(
            'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
          );
          await client.query(
            'create table if not exists "post" (id serial primary key, title text not null, "userId" int4 not null, "createdAt" timestamptz not null default now(), constraint post_userId_fkey foreign key ("userId") references "user"(id))',
          );
          await client.query('truncate table "post", "user" restart identity cascade');
          await client.query('insert into "user" (email, "createdAt") values ($1, now())', [
            'alice@example.com',
          ]);
        });

        const rowCount = await withClient(connectionString, async (client) => {
          const result = await client.query('select count(*)::int as count from "user"');
          return result.rows[0]?.count as number;
        });
        expect(rowCount).toBe(1);

        const tables = schema(contract).tables;
        const userTable = tables.user!;
        const plan = sql({ contract, adapter })
          .from(tables.user!)
          .select({
            id: userTable.columns.id!,
            email: userTable.columns.email!,
          })
          .limit(10)
          .build();

        type PlanRow = ResultType<typeof plan>;
        const rows: PlanRow[] = [];
        for await (const row of runtime.execute(plan)) {
          rows.push(row);
        }

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ email: 'alice@example.com' });

        const root = sql({ contract, adapter });
        const templatePlan = root.raw.with({ annotations: { limit: 1 } })`
          select id, email from "user"
          where email = ${'alice@example.com'}
          limit ${1}
        `;

        type TemplatePlanRow = ResultType<typeof templatePlan>;
        const templateRows: TemplatePlanRow[] = [];
        for await (const row of runtime.execute(templatePlan)) {
          templateRows.push(row);
        }
        expect(templateRows).toHaveLength(1);

        const functionPlan = root.raw('select id from "user" where email = $1 limit $2', {
          params: ['alice@example.com', 1],
          refs: { tables: ['user'], columns: [{ table: 'user', column: 'email' }] },
          annotations: { intent: 'report', limit: 1 },
        });

        type FunctionPlanRow = ResultType<typeof functionPlan>;
        const functionRows: FunctionPlanRow[] = [];
        for await (const row of runtime.execute(functionPlan)) {
          functionRows.push(row);
        }
        expect(functionRows).toHaveLength(1);

        await stampMarker({
          connectionString,
          coreHash: 'sha256:mismatched-core',
          profileHash: contract.profileHash ?? contract.coreHash,
        });

        await expect(async () => {
          const iterator = runtime.execute(plan)[Symbol.asyncIterator]();
          await iterator.next();
        }).rejects.toMatchObject({ code: 'CONTRACT.MARKER_MISMATCH' });
      } finally {
        await runtime.close();
      }
    });
  });

  it('infers correct types from query plans', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      const adapter = createPostgresAdapter();
      const pool = new Pool({ connectionString });
      const driver = createPostgresDriverFromOptions({
        connect: { pool },
        cursor: { disabled: true },
      });
      const runtime = createRuntime({
        contract,
        adapter,
        driver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [
          budgets({
            maxRows: 10_000,
            defaultTableRows: 10_000,
            tableRows: { user: 10_000, post: 10_000 },
          }),
        ],
      });

      try {
        await stampMarker({
          connectionString,
          coreHash: contract.coreHash,
          profileHash: contract.profileHash ?? contract.coreHash,
        });

        await withClient(connectionString, async (client) => {
          await client.query(
            'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
          );
          await client.query(
            'create table if not exists "post" (id serial primary key, title text not null, "userId" int4 not null, "createdAt" timestamptz not null default now(), constraint post_userId_fkey foreign key ("userId") references "user"(id))',
          );
          await client.query('truncate table "post", "user" restart identity cascade');
          await client.query('insert into "user" (email, "createdAt") values ($1, now())', [
            'alice@example.com',
          ]);
          await client.query(
            'insert into "post" (title, "userId", "createdAt") values ($1, $2, now())',
            ['First Post', 1],
          );
        });

        const tables = schema(contract).tables;
        const userTable = tables.user!;
        const postTable = tables.post!;

        const userPlan = sql({ contract, adapter })
          .from(userTable)
          .select({
            id: userTable.columns.id!,
            email: userTable.columns.email!,
            createdAt: userTable.columns.createdAt!,
          })
          .limit(10)
          .build();

        type UserRow = ResultType<typeof userPlan>;

        const postPlan = sql({ contract, adapter })
          .from(postTable)
          .where(postTable.columns.userId?.eq(param('userId')))
          .select({
            id: postTable.columns.id!,
            title: postTable.columns.title!,
            userId: postTable.columns.userId!,
            createdAt: postTable.columns.createdAt!,
          })
          .build({ params: { userId: 1 } });

        type PostRow = ResultType<typeof postPlan>;

        const userRows: UserRow[] = [];
        for await (const row of runtime.execute(userPlan)) {
          userRows.push(row);
        }
        expect(userRows).toHaveLength(1);
        expect(userRows[0]).toMatchObject({ email: 'alice@example.com' });

        const postRows: PostRow[] = [];
        for await (const row of runtime.execute(postPlan)) {
          postRows.push(row);
        }
        expect(postRows).toHaveLength(1);
        expect(postRows[0]).toMatchObject({ title: 'First Post', userId: 1 });
      } finally {
        await runtime.close();
      }
    });
  });

  it('enforces row budget on unbounded queries', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      const adapter = createPostgresAdapter();
      const pool = new Pool({ connectionString });
      const driver = createPostgresDriverFromOptions({
        connect: { pool },
        cursor: { disabled: true },
      });
      const runtime = createRuntime({
        contract,
        adapter,
        driver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [
          budgets({
            maxRows: 50,
            defaultTableRows: 10_000,
            tableRows: { user: 10_000, post: 10_000 },
          }),
        ],
      });

      try {
        await stampMarker({
          connectionString,
          coreHash: contract.coreHash,
          profileHash: contract.profileHash ?? contract.coreHash,
        });

        await withClient(connectionString, async (client) => {
          await client.query(
            'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
          );
          await client.query('truncate table "user" restart identity');
          for (let i = 0; i < 100; i++) {
            await client.query('insert into "user" (email, "createdAt") values ($1, now())', [
              `user${i}@example.com`,
            ]);
          }
        });

        const tables = schema(contract).tables;
        const userTable = tables.user!;
        const unboundedPlan = sql({ contract, adapter })
          .from(tables.user!)
          .select({
            id: userTable.columns.id!,
            email: userTable.columns.email!,
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

        const boundedPlan = sql({ contract, adapter })
          .from(tables.user!)
          .select({
            id: userTable.columns.id!,
            email: userTable.columns.email!,
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
    });
  });

  it('enforces streaming row budget', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      const adapter = createPostgresAdapter();
      const pool = new Pool({ connectionString });
      const driver = createPostgresDriverFromOptions({
        connect: { pool },
        cursor: { disabled: true },
      });
      const runtime = createRuntime({
        contract,
        adapter,
        driver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [
          budgets({
            maxRows: 10,
            defaultTableRows: 10_000,
            tableRows: { user: 10_000, post: 10_000 },
          }),
        ],
      });

      try {
        await stampMarker({
          connectionString,
          coreHash: contract.coreHash,
          profileHash: contract.profileHash ?? contract.coreHash,
        });

        await withClient(connectionString, async (client) => {
          await client.query(
            'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
          );
          await client.query('truncate table "user" restart identity');
          for (let i = 0; i < 50; i++) {
            await client.query('insert into "user" (email, "createdAt") values ($1, now())', [
              `user${i}@example.com`,
            ]);
          }
        });

        const tables = schema(contract).tables;
        const userTable = tables.user!;
        const plan = sql({ contract, adapter })
          .from(tables.user!)
          .select({
            id: userTable.columns.id!,
            email: userTable.columns.email!,
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
    });
  });
});
