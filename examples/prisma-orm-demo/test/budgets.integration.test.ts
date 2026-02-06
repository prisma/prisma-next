import postgresAdapterRuntime from '@prisma-next/adapter-postgres/runtime';
import { createExecutionStack } from '@prisma-next/core-execution-plane/stack';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql } from '@prisma-next/sql-lane';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { createRuntime } from '@prisma-next/sql-runtime';
import { createExecutionContext } from '@prisma-next/sql-runtime';
import postgresTargetRuntime from '@prisma-next/target-postgres/runtime';
import { withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma-next/contract.d';
import contractJson from '../src/prisma-next/contract.json' with { type: 'json' };
import { closeTestRuntime, createTestRuntime, initTestDatabase } from './utils/control-client';

// Use the emitted JSON contract which has the real computed hashes
const contract = validateContract<Contract>(contractJson);

const executionStack = createExecutionStack({
  target: postgresTargetRuntime,
  adapter: postgresAdapterRuntime,
  extensionPacks: [],
});

/**
 * Creates a runtime context for the given contract.
 */
function createContext(contractForContext: typeof contract) {
  return createExecutionContext({
    contract: contractForContext,
    stack: executionStack,
  });
}

/**
 * Seeds test users using the runtime and query DSL.
 */
async function seedTestUsers(
  runtime: ReturnType<typeof createRuntime>,
  count: number,
): Promise<void> {
  const context = createContext(contract);
  const tables = schema(context).tables;
  const userTable = tables['User'];
  if (!userTable) throw new Error('User table not found');

  for (let i = 0; i < count; i++) {
    const createdAt = new Date();

    const plan = sql({ context })
      .insert(userTable, {
        id: param('id'),
        email: param('email'),
        name: param('name'),
        createdAt: param('createdAt'),
      })
      .build({
        params: {
          id: `id-${i}`,
          email: `user${i}@example.com`,
          name: `User ${i}`,
          createdAt,
        },
      });

    for await (const _row of runtime.execute(plan)) {
      // consume iterator
    }
  }
}

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
      // Initialize schema using control client
      await initTestDatabase({ connection: connectionString, contractIR: contract });

      // Seed 100 test users using a runtime without strict budgets
      const { runtime: seedRuntime } = createTestRuntime(connectionString, contract);
      try {
        await seedTestUsers(seedRuntime, 100);
      } finally {
        await seedRuntime.close();
      }

      // Now create a runtime with strict budget for testing
      const { runtime, pool } = createTestRuntime(connectionString, contract, {
        maxRows: 50,
        defaultTableRows: 10_000,
        tableRows: { User: 10_000 },
      });

      try {
        const context = createContext(contract);
        const tables = schema(context).tables;
        const userTable = tables['User'];
        if (!userTable) throw new Error('User table not found');

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
      } finally {
        await closeTestRuntime({ runtime, pool });
      }
    }, {});
  });

  it('allows bounded SELECT queries within budget', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      await initTestDatabase({ connection: connectionString, contractIR: contract });

      // Seed users using a runtime without strict budgets
      const { runtime: seedRuntime } = createTestRuntime(connectionString, contract);
      try {
        await seedTestUsers(seedRuntime, 100);
      } finally {
        await seedRuntime.close();
      }

      const { runtime, pool } = createTestRuntime(connectionString, contract, {
        maxRows: 10_000,
        defaultTableRows: 10_000,
        tableRows: { User: 10_000 },
      });

      try {
        const context = createContext(contract);
        const tables = schema(context).tables;
        const userTable = tables['User'];
        if (!userTable) throw new Error('User table not found');

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
      } finally {
        await closeTestRuntime({ runtime, pool });
      }
    }, {});
  });

  it('enforces streaming row budget', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      await initTestDatabase({ connection: connectionString, contractIR: contract });

      // Seed users using a runtime without strict budgets
      const { runtime: seedRuntime } = createTestRuntime(connectionString, contract);
      try {
        await seedTestUsers(seedRuntime, 100);
      } finally {
        await seedRuntime.close();
      }

      const { runtime, pool } = createTestRuntime(connectionString, contract, {
        maxRows: 10,
        defaultTableRows: 10_000,
        tableRows: { User: 10_000 },
      });

      try {
        const context = createContext(contract);
        const tables = schema(context).tables;
        const userTable = tables['User'];
        if (!userTable) throw new Error('User table not found');

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
      } finally {
        await closeTestRuntime({ runtime, pool });
      }
    }, {});
  });
});
