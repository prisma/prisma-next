import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { sql } from '@prisma-next/sql-lane/sql';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { budgets } from '@prisma-next/sql-runtime';
import {
  createTestContext,
  drainPlanExecution,
  executePlanAndCollect,
  teardownTestDatabase,
} from '@prisma-next/sql-runtime/test/utils';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestRuntime, setupTestDatabase } from './utils';

const textColumn: StorageColumn = { nativeType: 'text', codecId: 'pg/text@1', nullable: false };

const fixtureContractRaw: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: coreHash('sha256:test-core'),
  profileHash: profileHash('sha256:test-profile'),
  storage: {
    tables: {
      user: {
        columns: {
          id: textColumn,
          email: textColumn,
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
  models: {},
  relations: {},
  mappings: {
    codecTypes: {},
    operationTypes: {},
  },
  capabilities: {},
  extensionPacks: {},
  meta: {},
  sources: {},
};
const fixtureContract = validateContract(fixtureContractRaw);

describe('budgets plugin integration', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let client: Client;

  beforeAll(async () => {
    database = await createDevDatabase();
    client = new Client({ connectionString: database.connectionString });
    await client.connect();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    try {
      await client.end();
      await database.close();
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    await setupTestDatabase(client, fixtureContract, async (c: typeof client) => {
      await c.query('drop table if exists "user"');
      await c.query('create table "user" (id text primary key, email text not null)');

      // Insert rows for budget testing (enough to test streaming but not overwhelm DB)
      const values: string[] = [];
      for (let i = 0; i < 100; i++) {
        values.push(`('id-${i}', 'user${i}@example.com')`);
      }
      await c.query(`insert into "user" (id, email) values ${values.join(', ')}`);
    });
  }, timeouts.databaseOperation);

  afterEach(async () => {
    await teardownTestDatabase(client, ['user']);
  }, timeouts.databaseOperation);

  it(
    'blocks unbounded DSL SELECT exceeding budget',
    async () => {
      const adapter = createPostgresAdapter();
      const runtime = await createTestRuntime(
        fixtureContract,
        {
          binding: { kind: 'pgClient', client },
          cursor: { disabled: true },
        },
        {
          verify: { mode: 'onFirstUse', requireMarker: false },
          plugins: [
            budgets({
              maxRows: 50, // Lower budget to ensure unbounded query exceeds it
              defaultTableRows: 10_000,
              tableRows: { user: 10_000 },
            }),
          ],
        },
      );

      const context = createTestContext(fixtureContract, adapter);
      const tables = schema(context).tables;
      const userTable = tables['user']!;
      const userColumns = userTable.columns;
      const builder = sql({ context });
      const plan = builder
        .from(userTable)
        .select({ id: userColumns['id']!, email: userColumns['email']! })
        .build();

      // Unbounded SELECT should be blocked pre-exec (estimated 10_000 > maxRows 50)
      await expect(async () => {
        await drainPlanExecution(runtime, plan);
      }).rejects.toMatchObject({
        code: 'BUDGET.ROWS_EXCEEDED',
        category: 'BUDGET',
      });
    },
    timeouts.databaseOperation,
  );

  it('blocks unbounded DSL SELECT when estimated equals budget', async () => {
    const adapter = createPostgresAdapter();
    const runtime = await createTestRuntime(
      fixtureContract,
      {
        binding: { kind: 'pgClient', client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [
          budgets({
            maxRows: 10_000, // Same as tableRows to test edge case
            defaultTableRows: 10_000,
            tableRows: { user: 10_000 },
          }),
        ],
      },
    );

    const context = createTestContext(fixtureContract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user']!;
    const userColumns = userTable.columns;
    const builder = sql({ context });
    const plan = builder
      .from(userTable)
      .select({ id: userColumns['id']!, email: userColumns['email']! })
      .build();

    // Unbounded SELECT should be blocked pre-exec even when estimated === maxRows
    // (estimated 10_000 >= maxRows 10_000)
    await expect(async () => {
      await drainPlanExecution(runtime, plan);
    }).rejects.toMatchObject({
      code: 'BUDGET.ROWS_EXCEEDED',
      category: 'BUDGET',
    });
  });

  it('allows bounded DSL SELECT within budget', async () => {
    const adapter = createPostgresAdapter();
    const runtime = await createTestRuntime(
      fixtureContract,
      {
        binding: { kind: 'pgClient', client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [
          budgets({
            maxRows: 10_000,
            defaultTableRows: 10_000,
            tableRows: { user: 10_000 },
          }),
        ],
      },
    );

    const context = createTestContext(fixtureContract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user']!;
    const userColumns = userTable.columns;
    const builder = sql({ context });
    const plan = builder
      .from(userTable)
      .select({ id: userColumns['id']!, email: userColumns['email']! })
      .limit(5)
      .build();

    // Bounded SELECT with LIMIT 5 should pass
    const results = await executePlanAndCollect(runtime, plan);
    expect(results.length).toBe(5);
  });

  it('blocks streaming when observed rows exceed budget', async () => {
    const adapter = createPostgresAdapter();
    const runtime = await createTestRuntime(
      fixtureContract,
      {
        binding: { kind: 'pgClient', client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [
          budgets({
            maxRows: 10,
            defaultTableRows: 10_000,
            tableRows: { user: 10_000 },
          }),
        ],
      },
    );

      const context = createTestContext(fixtureContract, adapter);
      const tables = schema(context).tables;
      const userTable = tables['user']!;
      const userColumns = userTable.columns;
      const builder = sql({ context });
      // Use LIMIT that's within heuristic but exceeds streaming budget
      const plan = builder
        .from(userTable)
        .select({ id: userColumns['id']!, email: userColumns['email']! })
        .limit(100)
        .build();

      // Should throw during streaming when observed rows > maxRows
      await expect(async () => {
        await drainPlanExecution(runtime, plan);
      }).rejects.toMatchObject({
        code: 'BUDGET.ROWS_EXCEEDED',
        category: 'BUDGET',
      });
    },
    timeouts.databaseOperation,
  );

  it('blocks unbounded raw SELECT without detectable LIMIT', async () => {
    const adapter = createPostgresAdapter();
    const runtime = await createTestRuntime(
      fixtureContract,
      {
        binding: { kind: 'pgClient', client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [
          budgets({
            maxRows: 10_000,
          }),
        ],
      },
    );

    const context = createTestContext(fixtureContract, adapter);
    const { raw } = sql({ context });
    const plan = raw`SELECT id, email FROM "user"`;

    // Unbounded raw SELECT should be blocked pre-exec
    await expect(async () => {
      await drainPlanExecution(runtime, plan);
    }).rejects.toMatchObject({
      code: 'BUDGET.ROWS_EXCEEDED',
      category: 'BUDGET',
    });
  });

  it('allows raw SELECT with detectable LIMIT via annotations', async () => {
    const adapter = createPostgresAdapter();
    const runtime = await createTestRuntime(
      fixtureContract,
      {
        binding: { kind: 'pgClient', client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [
          budgets({
            maxRows: 10_000,
          }),
        ],
      },
    );

    const context = createTestContext(fixtureContract, adapter);
    const { raw } = sql({ context });
    const plan = raw.with({ annotations: { limit: 5 } })`SELECT id, email FROM "user" LIMIT 5`;

    // Raw SELECT with limit annotation should pass
    const results = await executePlanAndCollect(runtime, plan);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('logs warning when latency exceeds budget in non-strict mode', async () => {
    const logWarn = vi.fn();
    const adapter = createPostgresAdapter();
    const runtime = await createTestRuntime(
      fixtureContract,
      {
        binding: { kind: 'pgClient', client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: false },
        mode: 'permissive',
        plugins: [
          budgets({
            maxRows: 10_000,
            maxLatencyMs: -1,
            severities: {
              latency: 'warn',
              rowCount: 'warn',
            },
          }),
        ],
        log: {
          info: vi.fn(),
          warn: logWarn,
          error: vi.fn(),
        },
      },
    );

    const context = createTestContext(fixtureContract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user']!;
    const userColumns = userTable.columns;
    const builder = sql({ context });
    const plan = builder
      .from(userTable)
      .select({ id: userColumns['id']!, email: userColumns['email']! })
      .limit(1)
      .build();

    const results = await executePlanAndCollect(runtime, plan);

    expect(results.length).toBeGreaterThan(0);
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'BUDGET.TIME_EXCEEDED',
      }),
    );
  });

  it('throws error when latency exceeds budget in strict mode with error severity', async () => {
    const adapter = createPostgresAdapter();
    const runtime = await createTestRuntime(
      fixtureContract,
      {
        binding: { kind: 'pgClient', client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'startup', requireMarker: false },
        mode: 'strict',
        plugins: [
          budgets({
            maxRows: 10_000,
            maxLatencyMs: -1,
            severities: {
              latency: 'error',
            },
          }),
        ],
      },
    );

    const context = createTestContext(fixtureContract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user']!;
    const userColumns = userTable.columns;
    const builder = sql({ context });
    const plan = builder
      .from(userTable)
      .select({ id: userColumns['id']!, email: userColumns['email']! })
      .limit(1)
      .build();

    await expect(async () => {
      await drainPlanExecution(runtime, plan);
    }).rejects.toMatchObject({
      code: 'BUDGET.TIME_EXCEEDED',
      category: 'BUDGET',
    });
  });

  it('does not throw when latency exceeds budget in non-strict mode with error severity', async () => {
    const logWarn = vi.fn();
    const adapter = createPostgresAdapter();
    const runtime = await createTestRuntime(
      fixtureContract,
      {
        binding: { kind: 'pgClient', client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: false },
        mode: 'permissive',
        plugins: [
          budgets({
            maxRows: 10_000,
            maxLatencyMs: -1,
            severities: {
              latency: 'error',
            },
          }),
        ],
        log: {
          info: vi.fn(),
          warn: logWarn,
          error: vi.fn(),
        },
      },
    );

    const context = createTestContext(fixtureContract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user']!;
    const userColumns = userTable.columns;
    const builder = sql({ context });
    const plan = builder
      .from(userTable)
      .select({ id: userColumns['id']!, email: userColumns['email']! })
      .limit(1)
      .build();

    const results = await executePlanAndCollect(runtime, plan);

    expect(results.length).toBeGreaterThan(0);
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'BUDGET.TIME_EXCEEDED',
      }),
    );
  });

  it('does not log warning when latency is within budget', async () => {
    const logWarn = vi.fn();
    const adapter = createPostgresAdapter();
    const runtime = await createTestRuntime(
      fixtureContract,
      {
        binding: { kind: 'pgClient', client },
        cursor: { disabled: true },
      },
      {
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [
          budgets({
            maxRows: 10_000,
            maxLatencyMs: 100_000,
            severities: {
              latency: 'warn',
            },
          }),
        ],
        log: {
          info: vi.fn(),
          warn: logWarn,
          error: vi.fn(),
        },
      },
    );

    const context = createTestContext(fixtureContract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user']!;
    const userColumns = userTable.columns;
    const builder = sql({ context });
    const plan = builder
      .from(userTable)
      .select({ id: userColumns['id']!, email: userColumns['email']! })
      .limit(1)
      .build();

    const results = await executePlanAndCollect(runtime, plan);

    expect(results.length).toBeGreaterThan(0);
    expect(logWarn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'BUDGET.TIME_EXCEEDED',
      }),
    );
  });
});
