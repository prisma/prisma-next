import type { Plan } from '@prisma-next/contract/types';
import type { OperationRegistry } from '@prisma-next/operations';
import { createOperationRegistry } from '@prisma-next/operations';
import { describe, expect, it } from 'vitest';
import type { MarkerReader, MarkerStatement, RuntimeFamilyAdapter } from '../src/runtime-spi';
import { createRuntimeCore } from '../src/runtime-core';
import type { Plugin } from '../src/plugins/types';

interface MockContract {
  readonly target: string;
  readonly targetFamily: string;
  readonly coreHash: string;
  readonly profileHash?: string;
}

class MockMarkerReader implements MarkerReader {
  private marker: { coreHash: string; profileHash: string } | null = null;

  readMarkerStatement(): MarkerStatement {
    return {
      sql: 'SELECT core_hash, profile_hash FROM mock_marker WHERE id = 1',
      params: [1],
    };
  }

  setMarker(coreHash: string, profileHash: string): void {
    this.marker = { coreHash, profileHash };
  }

  getMarker(): { coreHash: string; profileHash: string } | null {
    return this.marker;
  }
}

class MockDriver {
  private rows: ReadonlyArray<Record<string, unknown>> = [];

  setRows(rows: ReadonlyArray<Record<string, unknown>>): void {
    this.rows = rows;
  }

  async query(
    sql: string,
    params: readonly unknown[],
  ): Promise<{
    rows: ReadonlyArray<unknown>;
  }> {
    void sql;
    void params;
    return { rows: this.rows };
  }

  async *execute<Row = Record<string, unknown>>(options: {
    sql: string;
    params: readonly unknown[];
  }): AsyncIterable<Row> {
    void options;
    for (const row of this.rows) {
      yield row as Row;
    }
  }

  async close(): Promise<void> {
    // No-op
  }
}

class MockFamilyAdapter implements RuntimeFamilyAdapter<MockContract> {
  readonly contract: MockContract;
  readonly markerReader: MarkerReader;

  constructor(contract: MockContract, markerReader: MarkerReader) {
    this.contract = contract;
    this.markerReader = markerReader;
  }

  validatePlan(plan: Plan, contract: MockContract): void {
    if (plan.meta.target !== contract.target) {
      throw new Error(
        `Plan target ${plan.meta.target} does not match contract target ${contract.target}`,
      );
    }
    if (plan.meta.coreHash !== contract.coreHash) {
      throw new Error(
        `Plan coreHash ${plan.meta.coreHash} does not match contract coreHash ${contract.coreHash}`,
      );
    }
  }
}

describe('runtime-core with mock family', () => {
  it('executes plans without SQL dependencies', async () => {
    const contract: MockContract = {
      target: 'mock',
      targetFamily: 'mock',
      coreHash: 'sha256:test-core',
      profileHash: 'sha256:test-profile',
    };

    const markerReader = new MockMarkerReader();
    const familyAdapter = new MockFamilyAdapter(contract, markerReader);
    const driver = new MockDriver();
    const operationRegistry = createOperationRegistry();

    const runtime = createRuntimeCore({
      familyAdapter,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
      operationRegistry,
    });

    const plan: Plan = {
      sql: 'SELECT * FROM mock_table',
      params: [],
      meta: {
        target: 'mock',
        coreHash: 'sha256:test-core',
        lane: 'raw-sql',
        createdAt: new Date().toISOString(),
      },
    };

    driver.setRows([{ id: 1, name: 'test' }]);

    const results: unknown[] = [];
    for await (const row of runtime.execute(plan)) {
      results.push(row);
    }

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ id: 1, name: 'test' });
  });

  it('validates plans against contract', async () => {
    const contract: MockContract = {
      target: 'mock',
      targetFamily: 'mock',
      coreHash: 'sha256:test-core',
    };

    const markerReader = new MockMarkerReader();
    const familyAdapter = new MockFamilyAdapter(contract, markerReader);
    const driver = new MockDriver();
    const operationRegistry = createOperationRegistry();

    const runtime = createRuntimeCore({
      familyAdapter,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
      operationRegistry,
    });

    const invalidPlan: Plan = {
      sql: 'SELECT * FROM mock_table',
      params: [],
      meta: {
        target: 'other',
        coreHash: 'sha256:other-core',
        lane: 'raw-sql',
        createdAt: new Date().toISOString(),
      },
    };

    driver.setRows([]);

    await expect(async () => {
      for await (const _row of runtime.execute(invalidPlan)) {
        void _row;
      }
    }).rejects.toThrow('Plan target other does not match contract target mock');
  });

  it('supports plugins', async () => {
    const contract: MockContract = {
      target: 'mock',
      targetFamily: 'mock',
      coreHash: 'sha256:test-core',
    };

    const markerReader = new MockMarkerReader();
    const familyAdapter = new MockFamilyAdapter(contract, markerReader);
    const driver = new MockDriver();
    const operationRegistry = createOperationRegistry();

    let beforeExecuteCalled = false;
    let onRowCalled = false;
    let afterExecuteCalled = false;

    const plugin: Plugin<MockContract, unknown, MockDriver> = {
      name: 'test-plugin',
      async beforeExecute(plan, ctx) {
        void plan;
        void ctx;
        beforeExecuteCalled = true;
      },
      async onRow(row, plan, ctx) {
        void row;
        void plan;
        void ctx;
        onRowCalled = true;
      },
      async afterExecute(plan, result, ctx) {
        void plan;
        void result;
        void ctx;
        afterExecuteCalled = true;
      },
    };

    const runtime = createRuntimeCore({
      familyAdapter,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
      operationRegistry,
      plugins: [plugin],
    });

    const plan: Plan = {
      sql: 'SELECT * FROM mock_table',
      params: [],
      meta: {
        target: 'mock',
        coreHash: 'sha256:test-core',
        lane: 'raw-sql',
        createdAt: new Date().toISOString(),
      },
    };

    driver.setRows([{ id: 1 }]);

    for await (const _row of runtime.execute(plan)) {
      void _row;
    }

    expect(beforeExecuteCalled).toBe(true);
    expect(onRowCalled).toBe(true);
    expect(afterExecuteCalled).toBe(true);
  });

  it('provides operation registry', () => {
    const contract: MockContract = {
      target: 'mock',
      targetFamily: 'mock',
      coreHash: 'sha256:test-core',
    };

    const markerReader = new MockMarkerReader();
    const familyAdapter = new MockFamilyAdapter(contract, markerReader);
    const driver = new MockDriver();
    const operationRegistry = createOperationRegistry();

    const runtime = createRuntimeCore({
      familyAdapter,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
      operationRegistry,
    });

    expect(runtime.operations()).toBe(operationRegistry);
  });

  it('closes driver', async () => {
    const contract: MockContract = {
      target: 'mock',
      targetFamily: 'mock',
      coreHash: 'sha256:test-core',
    };

    const markerReader = new MockMarkerReader();
    const familyAdapter = new MockFamilyAdapter(contract, markerReader);
    const driver = new MockDriver();
    const operationRegistry = createOperationRegistry();

    const runtime = createRuntimeCore({
      familyAdapter,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
      operationRegistry,
    });

    await expect(runtime.close()).resolves.toBeUndefined();
  });
});
