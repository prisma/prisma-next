import { createRuntime } from '@prisma-next/sql-runtime';
import { describe, expect, it, vi } from 'vitest';

async function loadModules() {
  vi.resetModules();
  const [executionContextModule, queryModule] = await Promise.all([
    import('../src/prisma/execution-context'),
    import('../src/prisma/query'),
  ]);
  return {
    executionStackInstance: executionContextModule.executionStackInstance,
    executionContext: executionContextModule.executionContext,
    sql: queryModule.sql,
    tables: queryModule.tables,
  };
}

describe('when no driver is available', () => {
  it('can still build query plans', async () => {
    const { executionStackInstance, executionContext, sql, tables } = await loadModules();

    const runtime = createRuntime({
      stackInstance: executionStackInstance,
      contract: executionContext.contract,
      context: executionContext,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    const plan = sql.from(tables.user).select({ id: tables.user.columns.id }).limit(1).build();

    expect(plan).toMatchObject({
      ast: { kind: 'select' },
      meta: { lane: 'dsl' },
    });

    await expect(async () => {
      for await (const _row of runtime.execute(plan)) {
        // offline runtime should not execute
      }
    }).rejects.toMatchObject({ code: 'RUNTIME.DRIVER_MISSING' });

    await runtime.close();
  });

  it('can import query modules without DATABASE_URL', async () => {
    const original = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];

    try {
      const { executionContext, sql, tables } = await loadModules();

      expect(executionContext.contract.target).toBe('postgres');
      const plan = sql.from(tables.user).select({ id: tables.user.columns.id }).limit(1).build();

      expect(plan.meta.lane).toBe('dsl');
    } finally {
      if (original) {
        process.env['DATABASE_URL'] = original;
      } else {
        delete process.env['DATABASE_URL'];
      }
    }
  });
});
