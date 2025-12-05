import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres/runtime';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql } from '@prisma-next/sql-lane';
import { schema } from '@prisma-next/sql-relational-core/schema';
import {
  budgets,
  createRuntime,
  createRuntimeContext,
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '@prisma-next/sql-runtime';
import { withDevDatabase } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma-next/contract.d';
import contractJson from '../src/prisma-next/contract.json' with { type: 'json' };

const contract = validateContract<Contract>(contractJson);

/**
 * Extracts id and email columns from user table, throwing if either is missing.
 */
function getUserIdAndEmailColumns<T extends Record<string, unknown>>(userTable: {
  columns: T;
}): {
  idColumn: T['id'];
  emailColumn: T['email'];
} {
  const userColumns = userTable.columns;
  const idColumn = userColumns['id'];
  const emailColumn = userColumns['email'];
  if (!idColumn || !emailColumn) {
    throw new Error('Columns id or email not found');
  }
  return { idColumn: idColumn as T['id'], emailColumn: emailColumn as T['email'] };
}

describe('budgets plugin integration (prisma-orm-demo)', { timeout: 30000 }, () => {
  it('blocks unbounded SELECT queries', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      const adapter = createPostgresAdapter();
      const client = new Client({ connectionString });
      await client.connect();
      const driver = createPostgresDriverFromOptions({
        connect: { client },
        cursor: { disabled: true },
      });

      try {
        await client.query('drop schema if exists prisma_contract cascade');
        await client.query('create schema if not exists public');
        await client.query('drop table if exists "User"');
        await client.query(`
          create table "User" (
            id text primary key,
            email text not null unique,
            name text not null,
            "createdAt" timestamptz not null default now()
          )
        `);

        // Insert test data
        for (let i = 0; i < 100; i++) {
          await client.query(
            'insert into "User" (id, email, name, "createdAt") values ($1, $2, $3, now())',
            [`id-${i}`, `user${i}@example.com`, `User ${i}`],
          );
        }

        await client.query(ensureSchemaStatement.sql);
        await client.query(ensureTableStatement.sql);

        const write = writeContractMarker({
          coreHash: contract.coreHash,
          profileHash: contract.profileHash ?? 'sha256:test-profile',
          contractJson: contract,
          canonicalVersion: 1,
        });
        await client.query(write.insert.sql, [...write.insert.params]);

        const context = createRuntimeContext({ contract, adapter, extensions: [] });
        const runtime = createRuntime({
          context,
          adapter,
          driver,
          verify: { mode: 'onFirstUse', requireMarker: false },
          plugins: [
            budgets({
              maxRows: 50,
              defaultTableRows: 10_000,
              tableRows: { User: 10_000 },
            }),
          ],
        });

        const tables = schema(context).tables;
        const userTable = tables['User'];
        if (!userTable) {
          throw new Error('User table not found');
        }
        const { idColumn, emailColumn } = getUserIdAndEmailColumns(userTable);
        const plan = sql({ context })
          .from(userTable)
          .select({
            id: idColumn,
            email: emailColumn,
          })
          .build();

        // Unbounded SELECT should be blocked pre-exec
        await expect(async () => {
          for await (const _row of runtime.execute(plan)) {
            // Should not reach here
          }
        }).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          category: 'BUDGET',
        });

        await runtime.close();
      } finally {
        await client.end();
      }
    }, {});
  });

  it('allows bounded SELECT queries within budget', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      const adapter = createPostgresAdapter();
      const client = new Client({ connectionString });
      await client.connect();
      const driver = createPostgresDriverFromOptions({
        connect: { client },
        cursor: { disabled: true },
      });

      try {
        await client.query('drop schema if exists prisma_contract cascade');
        await client.query('create schema if not exists public');
        await client.query('drop table if exists "User"');
        await client.query(`
          create table "User" (
            id text primary key,
            email text not null unique,
            name text not null,
            "createdAt" timestamptz not null default now()
          )
        `);

        // Insert test data
        for (let i = 0; i < 100; i++) {
          await client.query(
            'insert into "User" (id, email, name, "createdAt") values ($1, $2, $3, now())',
            [`id-${i}`, `user${i}@example.com`, `User ${i}`],
          );
        }

        await client.query(ensureSchemaStatement.sql);
        await client.query(ensureTableStatement.sql);

        const write = writeContractMarker({
          coreHash: contract.coreHash,
          profileHash: contract.profileHash ?? 'sha256:test-profile',
          contractJson: contract,
          canonicalVersion: 1,
        });
        await client.query(write.insert.sql, [...write.insert.params]);

        const context = createRuntimeContext({ contract, adapter, extensions: [] });
        const runtime = createRuntime({
          context,
          adapter,
          driver,
          verify: { mode: 'onFirstUse', requireMarker: false },
          plugins: [
            budgets({
              maxRows: 10_000,
              defaultTableRows: 10_000,
              tableRows: { User: 10_000 },
            }),
          ],
        });

        const tables = schema(context).tables;
        const userTable = tables['User'];
        if (!userTable) {
          throw new Error('User table not found');
        }
        const { idColumn, emailColumn } = getUserIdAndEmailColumns(userTable);
        const plan = sql({ context })
          .from(userTable)
          .select({
            id: idColumn,
            email: emailColumn,
          })
          .limit(10)
          .build();

        // Bounded SELECT should pass
        const results: Record<string, unknown>[] = [];
        for await (const row of runtime.execute(plan)) {
          results.push(row);
        }
        expect(results.length).toBeLessThanOrEqual(10);

        await runtime.close();
      } finally {
        await client.end();
      }
    }, {});
  });

  it('enforces streaming row budget', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      const adapter = createPostgresAdapter();
      const client = new Client({ connectionString });
      await client.connect();
      const driver = createPostgresDriverFromOptions({
        connect: { client },
        cursor: { disabled: true },
      });

      try {
        await client.query('drop schema if exists prisma_contract cascade');
        await client.query('create schema if not exists public');
        await client.query('drop table if exists "User"');
        await client.query(`
          create table "User" (
            id text primary key,
            email text not null unique,
            name text not null,
            "createdAt" timestamptz not null default now()
          )
        `);

        // Insert test data
        for (let i = 0; i < 100; i++) {
          await client.query(
            'insert into "User" (id, email, name, "createdAt") values ($1, $2, $3, now())',
            [`id-${i}`, `user${i}@example.com`, `User ${i}`],
          );
        }

        await client.query(ensureSchemaStatement.sql);
        await client.query(ensureTableStatement.sql);

        const write = writeContractMarker({
          coreHash: contract.coreHash,
          profileHash: contract.profileHash ?? 'sha256:test-profile',
          contractJson: contract,
          canonicalVersion: 1,
        });
        await client.query(write.insert.sql, [...write.insert.params]);

        const context = createRuntimeContext({ contract, adapter, extensions: [] });
        const runtime = createRuntime({
          context,
          adapter,
          driver,
          verify: { mode: 'onFirstUse', requireMarker: false },
          plugins: [
            budgets({
              maxRows: 10,
              defaultTableRows: 10_000,
              tableRows: { User: 10_000 },
            }),
          ],
        });

        const tables = schema(context).tables;
        const userTable = tables['User'];
        if (!userTable) {
          throw new Error('User table not found');
        }
        const { idColumn, emailColumn } = getUserIdAndEmailColumns(userTable);
        const plan = sql({ context })
          .from(userTable)
          .select({
            id: idColumn,
            email: emailColumn,
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

        await runtime.close();
      } finally {
        await client.end();
      }
    }, {});
  });
});
