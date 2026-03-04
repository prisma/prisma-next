import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import { executeQueryPlan } from '../src/execute-query-plan';

describe('execute query plan', () => {
  it('forwards SQL query plans to runtime.execute', () => {
    const execute = vi.fn();
    const executor = { execute };
    const plan: SqlQueryPlan<{ id: number }> = {
      ast: {
        kind: 'select',
        from: { kind: 'table', name: 'users' },
        project: [{ alias: 'id', expr: { kind: 'col', table: 'users', column: 'id' } }],
      },
      params: [],
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'storage-hash',
        lane: 'orm-client',
        paramDescriptors: [],
      },
    };

    executeQueryPlan(executor, plan);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toBe(plan);
  });

  it('also forwards already-lowered execution plans', () => {
    const execute = vi.fn();
    const executor = { execute };
    const plan: ExecutionPlan<{ id: number }> = {
      sql: 'select 1',
      params: [],
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'storage-hash',
        lane: 'orm-client',
        paramDescriptors: [],
      },
    };

    executeQueryPlan(executor, plan);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toBe(plan);
  });
});
