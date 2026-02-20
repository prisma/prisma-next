import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { RuntimeConnection, RuntimeTransaction } from '@prisma-next/runtime-executor';
import type { QueryResult } from 'kysely';
import { describe, expect, it } from 'vitest';
import { KyselyPrismaConnection } from '../src/connection';
import { createAsyncResult, createCompiledQuery, createTestContract } from './helpers';

interface CapturedExecution<Row = unknown> {
  readonly plan: ExecutionPlan<Row>;
  readonly rows: readonly Row[];
}

function createRuntimeConnection(
  rowsByExecution: readonly Record<string, unknown>[][],
): {
  readonly connection: RuntimeConnection;
  readonly executions: CapturedExecution[];
} {
  const executionQueue = [...rowsByExecution];
  const executions: CapturedExecution[] = [];

  const transaction: RuntimeTransaction = {
    execute<Row>(plan: ExecutionPlan<Row>) {
      const rows = (executionQueue.shift() ?? []) as Row[];
      executions.push({
        plan,
        rows,
      });
      return createAsyncResult(rows);
    },
    async commit(): Promise<void> {
      // noop for tests
    },
    async rollback(): Promise<void> {
      // noop for tests
    },
  };

  const connection: RuntimeConnection = {
    execute<Row>(plan: ExecutionPlan<Row>) {
      const rows = (executionQueue.shift() ?? []) as Row[];
      executions.push({
        plan,
        rows,
      });
      return createAsyncResult(rows);
    },
    async transaction(): Promise<RuntimeTransaction> {
      return transaction;
    },
    async release(): Promise<void> {
      // noop for tests
    },
  };

  return {
    connection,
    executions,
  };
}

describe('KyselyPrismaConnection', () => {
  it('executeQuery uses raw lane execution plan and returns rows', async () => {
    const contract = createTestContract();
    const compiledQuery = createCompiledQuery<{ id: number }>('select "id" from "users"', []);
    const runtimeConnection = createRuntimeConnection([[{ id: 1 }, { id: 2 }]]);
    const connection = new KyselyPrismaConnection(contract, runtimeConnection.connection);

    const result = await connection.executeQuery<{ id: number }>(compiledQuery);

    expect(result).toEqual<QueryResult<{ id: number }>>({
      rows: [{ id: 1 }, { id: 2 }],
    });
    expect(runtimeConnection.executions).toHaveLength(1);
    expect(runtimeConnection.executions[0]?.plan.sql).toBe(compiledQuery.sql);
    expect(runtimeConnection.executions[0]?.plan.params).toEqual(compiledQuery.parameters);
    expect(runtimeConnection.executions[0]?.plan.meta.lane).toBe('raw');
  });

  it('streamQuery preserves chunking behavior with converted plans', async () => {
    const contract = createTestContract();
    const compiledQuery = createCompiledQuery<{ id: number }>('select "id" from "users"', []);
    const runtimeConnection = createRuntimeConnection([[{ id: 1 }, { id: 2 }, { id: 3 }]]);
    const connection = new KyselyPrismaConnection(contract, runtimeConnection.connection);

    const chunks: QueryResult<{ id: number }>[] = [];
    for await (const chunk of connection.streamQuery<{ id: number }>(compiledQuery, 2)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { rows: [{ id: 1 }, { id: 2 }] },
      { rows: [{ id: 3 }] },
    ]);
    expect(runtimeConnection.executions).toHaveLength(1);
    expect(runtimeConnection.executions[0]?.plan.meta.lane).toBe('raw');
  });

  it('executeQuery throws after release', async () => {
    const contract = createTestContract();
    const compiledQuery = createCompiledQuery('select 1');
    const runtimeConnection = createRuntimeConnection([[]]);
    const connection = new KyselyPrismaConnection(contract, runtimeConnection.connection);

    await connection.release();

    await expect(connection.executeQuery(compiledQuery)).rejects.toThrow(
      'Invoked executeQuery on released connection',
    );
  });
});
