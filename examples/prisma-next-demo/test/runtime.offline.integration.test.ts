import { createRuntime } from '@prisma-next/sql-runtime';
import { describe, expect, it } from 'vitest';
import { executionContext, executionStackInstance } from '../src/prisma/execution-context';
import { sql, tables } from '../src/prisma/query';

describe('when no driver is available', () => {
  it('can still build query plans', async () => {
    const runtime = createRuntime({
      stackInstance: executionStackInstance,
      contract: executionContext.contract,
      context: executionContext,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    try {
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
    } finally {
      await runtime.close();
    }
  });
});
