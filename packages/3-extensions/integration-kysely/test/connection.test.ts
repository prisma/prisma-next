import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { RuntimeConnection, RuntimeTransaction } from '@prisma-next/runtime-executor';
import type { CompiledQuery, QueryResult } from 'kysely';
import { describe, expect, it } from 'vitest';
import { KyselyPrismaConnection } from '../src/connection';
import { createAsyncResult, createCompiledQuery, createTestContract } from './helpers';
import { contract as sqlContractFixture } from './transform.fixtures';

interface CapturedExecution<Row = unknown> {
  readonly source: 'connection' | 'transaction';
  readonly plan: ExecutionPlan<Row>;
  readonly rows: readonly Row[];
}

function createRuntimeConnection(rowsByExecution: readonly Record<string, unknown>[][]): {
  readonly connection: RuntimeConnection;
  readonly executions: CapturedExecution[];
} {
  const executionQueue = [...rowsByExecution];
  const executions: CapturedExecution[] = [];

  const transaction: RuntimeTransaction = {
    execute<Row>(plan: ExecutionPlan<Row>) {
      const rows = (executionQueue.shift() ?? []) as Row[];
      executions.push({
        source: 'transaction',
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
        source: 'connection',
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

    expect(chunks).toEqual([{ rows: [{ id: 1 }, { id: 2 }] }, { rows: [{ id: 3 }] }]);
    expect(runtimeConnection.executions).toHaveLength(1);
    expect(runtimeConnection.executions[0]?.source).toBe('connection');
    expect(runtimeConnection.executions[0]?.plan.meta.lane).toBe('raw');
  });

  it('executeQuery uses transaction executor while transaction is active', async () => {
    const contract = createTestContract();
    const compiledQuery = createCompiledQuery<{ id: number }>('select "id" from "users"', []);
    const runtimeConnection = createRuntimeConnection([[{ id: 10 }]]);
    const connection = new KyselyPrismaConnection(contract, runtimeConnection.connection);

    await connection.beginTransaction({});
    const result = await connection.executeQuery<{ id: number }>(compiledQuery);

    expect(result.rows).toEqual([{ id: 10 }]);
    expect(runtimeConnection.executions).toHaveLength(1);
    expect(runtimeConnection.executions[0]?.source).toBe('transaction');
  });

  it('executeQuery returns to connection executor after commit', async () => {
    const contract = createTestContract();
    const compiledQuery = createCompiledQuery<{ id: number }>('select "id" from "users"', []);
    const runtimeConnection = createRuntimeConnection([[{ id: 11 }]]);
    const connection = new KyselyPrismaConnection(contract, runtimeConnection.connection);

    await connection.beginTransaction({});
    await connection.commitTransaction();
    const result = await connection.executeQuery<{ id: number }>(compiledQuery);

    expect(result.rows).toEqual([{ id: 11 }]);
    expect(runtimeConnection.executions).toHaveLength(1);
    expect(runtimeConnection.executions[0]?.source).toBe('connection');
  });

  it('executeQuery returns to connection executor after rollback', async () => {
    const contract = createTestContract();
    const compiledQuery = createCompiledQuery<{ id: number }>('select "id" from "users"', []);
    const runtimeConnection = createRuntimeConnection([[{ id: 12 }]]);
    const connection = new KyselyPrismaConnection(contract, runtimeConnection.connection);

    await connection.beginTransaction({});
    await connection.rollbackTransaction();
    const result = await connection.executeQuery<{ id: number }>(compiledQuery);

    expect(result.rows).toEqual([{ id: 12 }]);
    expect(runtimeConnection.executions).toHaveLength(1);
    expect(runtimeConnection.executions[0]?.source).toBe('connection');
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

  it('executeQuery fails unsupported Kysely query kinds with stable envelope', async () => {
    const contract = createTestContract();
    const runtimeConnection = createRuntimeConnection([[]]);
    const connection = new KyselyPrismaConnection(contract, runtimeConnection.connection);
    const compiledQuery = {
      query: { kind: 'WithNode' },
      queryId: {} as never,
      sql: 'with x as (select 1) select * from x',
      parameters: [],
    } as unknown as CompiledQuery<unknown>;

    await expect(connection.executeQuery(compiledQuery)).rejects.toMatchObject({
      code: 'PLAN.UNSUPPORTED',
      category: 'PLAN',
      details: {
        lane: 'kysely',
        kyselyKind: 'WithNode',
      },
    });
    expect(runtimeConnection.executions).toHaveLength(0);
  });

  it('maps transform unsupported errors to PLAN.UNSUPPORTED envelope', async () => {
    const runtimeConnection = createRuntimeConnection([[]]);
    const connection = new KyselyPrismaConnection(sqlContractFixture, runtimeConnection.connection);
    const compiledQuery = {
      query: {
        kind: 'InsertQueryNode',
        into: {
          kind: 'TableNode',
          table: { kind: 'IdentifierNode', name: 'user' },
        },
        columns: [
          { kind: 'ColumnNode', column: { kind: 'IdentifierNode', name: 'id' } },
          { kind: 'ColumnNode', column: { kind: 'IdentifierNode', name: 'email' } },
        ],
        values: {
          kind: 'ValuesNode',
          values: [
            {
              kind: 'PrimitiveValueListNode',
              values: [
                { kind: 'ValueNode', value: 'a' },
                { kind: 'ValueNode', value: 'a@example.com' },
              ],
            },
            {
              kind: 'PrimitiveValueListNode',
              values: [
                { kind: 'ValueNode', value: 'b' },
                { kind: 'ValueNode', value: 'b@example.com' },
              ],
            },
          ],
        },
      },
      queryId: {} as never,
      sql: 'insert into "user" ("id","email") values ($1,$2), ($3,$4)',
      parameters: ['a', 'a@example.com', 'b', 'b@example.com'],
    } as unknown as CompiledQuery<unknown>;

    await expect(connection.executeQuery(compiledQuery)).rejects.toMatchObject({
      code: 'PLAN.UNSUPPORTED',
      category: 'PLAN',
      details: {
        lane: 'kysely',
        kyselyKind: 'InsertQueryNode',
      },
    });
    expect(runtimeConnection.executions).toHaveLength(0);
  });
});
