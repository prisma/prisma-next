import { describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { PostgresDriver } from '@prisma-next/driver-postgres';
import {
  createRuntime,
  budgets,
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '@prisma-next/runtime';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { unstable_startServer } from '@prisma/dev';
import type { StartServerOptions } from '@prisma/dev';
import contract from '../src/prisma-next/contract.json' assert { type: 'json' };
import type { DataContract } from '@prisma-next/sql/types';
import { sql } from '@prisma-next/sql/sql';
import { schema } from '@prisma-next/sql/schema';
import type { TableRef, ColumnBuilder } from '@prisma-next/sql/types';

// Copy of withDevDatabase helper (like compat-prisma does)
function normalizeConnectionString(raw: string): string {
  const url = new URL(raw);
  if (url.hostname === 'localhost' || url.hostname === '::1') {
    url.hostname = '127.0.0.1';
  }
  return url.toString();
}

async function withDevDatabase<T>(
  fn: (ctx: { connectionString: string }) => Promise<T>,
  options?: StartServerOptions,
): Promise<T> {
  const server = await unstable_startServer(options);
  const connectionString = normalizeConnectionString(server.database.connectionString);

  try {
    return await fn({ connectionString });
  } finally {
    await server.close();
  }
}

// Helper to create a table ref with correct name property (avoids name column conflict)
function createTableRef(
  tables: { readonly [key: string]: TableRef & Record<string, ColumnBuilder> },
  tableName: string,
): TableRef & Record<string, ColumnBuilder> {
  const table = tables[tableName];
  if (!table) {
    throw new Error(`Table ${tableName} not found`);
  }
  // Use Object.assign with name last to ensure table name overwrites column
  return Object.assign({}, table, { name: tableName }) as TableRef & Record<string, ColumnBuilder>;
}

describe('budgets plugin integration (prisma-orm-demo)', { timeout: 30000 }, () => {
  it('blocks unbounded SELECT queries', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      const adapter = createPostgresAdapter();
      const client = new Client({ connectionString });
      await client.connect();
      const driver = new PostgresDriver({
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
          coreHash: (contract as DataContract).coreHash,
          profileHash: (contract as DataContract).profileHash ?? 'sha256:test-profile',
          contractJson: contract,
          canonicalVersion: 1,
        });
        await client.query(write.insert.sql, [...write.insert.params]);

        const runtime = createRuntime({
          contract: contract as DataContract,
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

        const tables = schema(contract as DataContract).tables;
        const tableRef = createTableRef(tables, 'User');
        const plan = sql({ contract: contract as DataContract, adapter })
          .from(tableRef)
          .select('id', 'email')
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
    });
  });

  it('allows bounded SELECT queries within budget', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      const adapter = createPostgresAdapter();
      const client = new Client({ connectionString });
      await client.connect();
      const driver = new PostgresDriver({
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
          coreHash: (contract as DataContract).coreHash,
          profileHash: (contract as DataContract).profileHash ?? 'sha256:test-profile',
          contractJson: contract,
          canonicalVersion: 1,
        });
        await client.query(write.insert.sql, [...write.insert.params]);

        const runtime = createRuntime({
          contract: contract as DataContract,
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

        const tables = schema(contract as DataContract).tables;
        const tableRef = createTableRef(tables, 'User');
        const plan = sql({ contract: contract as DataContract, adapter })
          .from(tableRef)
          .select('id', 'email')
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
    });
  });

  it('enforces streaming row budget', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      const adapter = createPostgresAdapter();
      const client = new Client({ connectionString });
      await client.connect();
      const driver = new PostgresDriver({
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
          coreHash: (contract as DataContract).coreHash,
          profileHash: (contract as DataContract).profileHash ?? 'sha256:test-profile',
          contractJson: contract,
          canonicalVersion: 1,
        });
        await client.query(write.insert.sql, [...write.insert.params]);

        const runtime = createRuntime({
          contract: contract as DataContract,
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

        const tables = schema(contract as DataContract).tables;
        const tableRef = createTableRef(tables, 'User');
        const plan = sql({ contract: contract as DataContract, adapter })
          .from(tableRef)
          .select('id', 'email')
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
    });
  });
});
