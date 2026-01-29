import type { ExecutionPlan } from '@prisma-next/contract/types';
import {
  createExecutionStack,
  instantiateExecutionStack,
} from '@prisma-next/core-execution-plane/stack';
import type { RuntimeDriverDescriptor } from '@prisma-next/core-execution-plane/types';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';
import { describe, expect, it } from 'vitest';
import type { Runtime } from '../src/exports';
import { createExecutionContext, createRuntime } from '../src/exports';
import { createStubAdapter, createTestContract } from './utils';

class MockDriver {
  private rows: ReadonlyArray<Record<string, unknown>> = [];

  setRows(rows: ReadonlyArray<Record<string, unknown>>): void {
    this.rows = rows;
  }

  async query(
    _sql: string,
    _params: readonly unknown[],
  ): Promise<{ rows: ReadonlyArray<unknown> }> {
    return { rows: [] };
  }

  async *execute<Row = Record<string, unknown>>(_options: {
    sql: string;
    params: readonly unknown[];
  }): AsyncIterable<Row> {
    for (const row of this.rows) {
      yield row as Row;
    }
  }

  async connect(): Promise<void> {}

  async close(): Promise<void> {}
}

const fixtureContract = createTestContract({
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  coreHash: 'test-hash',
  profileHash: 'test-profile-hash',
  storage: {
    tables: {
      user: {
        columns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
  models: {},
  relations: {},
  mappings: { codecTypes: {}, operationTypes: {} },
});

function createTestRuntime(driver: MockDriver): Runtime {
  const adapter = createStubAdapter();
  const driverDescriptor: RuntimeDriverDescriptor<'sql', 'postgres'> = {
    kind: 'driver',
    id: 'test-driver',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    create() {
      return Object.assign(driver, {
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
      });
    },
  };
  const stack = createExecutionStack({
    target: {
      kind: 'target',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      create() {
        return { familyId: 'sql' as const, targetId: 'postgres' as const };
      },
    },
    adapter: {
      kind: 'adapter',
      id: 'test-adapter',
      version: '0.0.1',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      create() {
        return Object.assign({ familyId: 'sql' as const, targetId: 'postgres' as const }, adapter);
      },
    },
    driver: driverDescriptor,
    extensionPacks: [],
  });
  const stackInstance = instantiateExecutionStack(stack);
  const context = createExecutionContext({ contract: fixtureContract, stackInstance });
  return createRuntime({
    stackInstance,
    contract: fixtureContract,
    context,
    driverOptions: {},
    verify: { mode: 'onFirstUse', requireMarker: false },
  });
}

describe('SqlRuntime AsyncIterableResult integration', () => {
  it('returns AsyncIterableResult from execute', async () => {
    const driver = new MockDriver();
    driver.setRows([
      { id: 1, email: 'test1@example.com' },
      { id: 2, email: 'test2@example.com' },
    ]);
    const runtime = createTestRuntime(driver);

    const plan: ExecutionPlan<{ id: number; email: string }> = {
      sql: 'SELECT id, email FROM "user" ORDER BY id',
      params: [],
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'test-hash',
        lane: 'sql',
        paramDescriptors: [],
      },
    };

    const result = runtime.execute(plan);

    expect(result).toBeInstanceOf(Object);
    expect(typeof result.toArray).toBe('function');
    expect(typeof result[Symbol.asyncIterator]).toBe('function');

    await runtime.close();
  });

  it('preserves type information', async () => {
    const driver = new MockDriver();
    driver.setRows([{ id: 1, email: 'test@example.com' }]);
    const runtime = createTestRuntime(driver);

    const plan: ExecutionPlan<{ id: number; email: string }> = {
      sql: 'SELECT id, email FROM "user" LIMIT 1',
      params: [],
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'test-hash',
        lane: 'sql',
        paramDescriptors: [],
      },
    };

    const result: AsyncIterableResult<{ id: number; email: string }> = runtime.execute(plan);
    const rows = await result.toArray();

    expect(rows.length).toBe(1);
    if (rows[0]) {
      expect(typeof rows[0].id).toBe('number');
      expect(typeof rows[0].email).toBe('string');
    }

    await runtime.close();
  });
});
