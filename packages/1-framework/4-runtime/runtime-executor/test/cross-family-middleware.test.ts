import type { ExecutionPlan, PlanMeta } from '@prisma-next/contract/types';
import type {
  AfterExecuteResult,
  RuntimeMiddleware,
} from '@prisma-next/framework-components/runtime';
import { describe, expect, it } from 'vitest';
import { createRuntimeCore } from '../src/runtime-core';
import type { MarkerReader, MarkerStatement, RuntimeFamilyAdapter } from '../src/runtime-spi';

interface TelemetryRecord {
  readonly phase: 'before' | 'after';
  readonly lane: string;
  readonly target: string;
  readonly storageHash: string;
  readonly rowCount?: number;
  readonly latencyMs?: number;
  readonly completed?: boolean;
}

function createTelemetryMiddleware(): RuntimeMiddleware & {
  records: TelemetryRecord[];
} {
  const records: TelemetryRecord[] = [];
  return {
    name: 'cross-family-telemetry',
    records,
    async beforeExecute(plan: { readonly meta: PlanMeta }) {
      records.push({
        phase: 'before',
        lane: plan.meta.lane,
        target: plan.meta.target,
        storageHash: plan.meta.storageHash,
      });
    },
    async afterExecute(plan: { readonly meta: PlanMeta }, result: AfterExecuteResult) {
      records.push({
        phase: 'after',
        lane: plan.meta.lane,
        target: plan.meta.target,
        storageHash: plan.meta.storageHash,
        rowCount: result.rowCount,
        latencyMs: result.latencyMs,
        completed: result.completed,
      });
    },
  };
}

class MockMarkerReader implements MarkerReader {
  readMarkerStatement(): MarkerStatement {
    return { sql: 'SELECT 1', params: [] };
  }
}

interface MockContract {
  readonly target: string;
  readonly targetFamily: string;
  readonly storageHash: string;
}

class MockFamilyAdapter implements RuntimeFamilyAdapter<MockContract> {
  readonly contract: MockContract;
  readonly markerReader: MarkerReader;

  constructor(contract: MockContract) {
    this.contract = contract;
    this.markerReader = new MockMarkerReader();
  }

  validatePlan(_plan: ExecutionPlan, _contract: MockContract): void {}
}

class MockSqlDriver {
  private rows: ReadonlyArray<Record<string, unknown>>;

  constructor(rows: ReadonlyArray<Record<string, unknown>> = []) {
    this.rows = rows;
  }

  async query(_sql: string, _params: readonly unknown[]) {
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

  async close(): Promise<void> {}
}

describe('cross-family middleware proof', () => {
  it('same middleware observes queries from an SQL-like runtime', async () => {
    const telemetry = createTelemetryMiddleware();

    const sqlContract: MockContract = {
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:sql-test',
    };

    const sqlRuntime = createRuntimeCore({
      familyAdapter: new MockFamilyAdapter(sqlContract),
      driver: new MockSqlDriver([{ id: 1, name: 'Alice' }]),
      verify: { mode: 'onFirstUse', requireMarker: false },
      middlewares: [telemetry],
    });

    const sqlPlan: ExecutionPlan = {
      sql: 'SELECT id, name FROM users',
      params: [],
      meta: {
        target: 'postgres',
        storageHash: 'sha256:sql-test',
        lane: 'sql',
        paramDescriptors: [],
      },
    };

    for await (const _row of sqlRuntime.execute(sqlPlan)) {
      void _row;
    }

    expect(telemetry.records).toHaveLength(2);
    expect(telemetry.records[0]).toMatchObject({
      phase: 'before',
      lane: 'sql',
      target: 'postgres',
      storageHash: 'sha256:sql-test',
    });
    expect(telemetry.records[1]).toMatchObject({
      phase: 'after',
      lane: 'sql',
      target: 'postgres',
      rowCount: 1,
      completed: true,
    });
  });

  it('generic middleware uses only PlanMeta — no family-specific plan fields', async () => {
    const telemetry = createTelemetryMiddleware();

    const contract: MockContract = {
      target: 'mongo',
      targetFamily: 'mongo',
      storageHash: 'sha256:mongo-test',
    };

    const runtime = createRuntimeCore({
      familyAdapter: new MockFamilyAdapter(contract),
      driver: new MockSqlDriver([
        { _id: '1', name: 'Bob' },
        { _id: '2', name: 'Carol' },
      ]),
      verify: { mode: 'onFirstUse', requireMarker: false },
      middlewares: [telemetry],
    });

    const plan: ExecutionPlan = {
      sql: 'placeholder',
      params: [],
      meta: {
        target: 'mongo',
        storageHash: 'sha256:mongo-test',
        lane: 'orm',
        paramDescriptors: [],
      },
    };

    for await (const _row of runtime.execute(plan)) {
      void _row;
    }

    expect(telemetry.records).toHaveLength(2);
    expect(telemetry.records[0]).toMatchObject({
      phase: 'before',
      lane: 'orm',
      target: 'mongo',
      storageHash: 'sha256:mongo-test',
    });
    expect(telemetry.records[1]).toMatchObject({
      phase: 'after',
      rowCount: 2,
      completed: true,
    });
  });

  it('same middleware instance works across multiple runtimes', async () => {
    const telemetry = createTelemetryMiddleware();

    const sqlContract: MockContract = {
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:sql-hash',
    };
    const mongoContract: MockContract = {
      target: 'mongo',
      targetFamily: 'mongo',
      storageHash: 'sha256:mongo-hash',
    };

    const sqlRuntime = createRuntimeCore({
      familyAdapter: new MockFamilyAdapter(sqlContract),
      driver: new MockSqlDriver([{ id: 1 }]),
      verify: { mode: 'onFirstUse', requireMarker: false },
      middlewares: [telemetry],
    });

    const mongoRuntime = createRuntimeCore({
      familyAdapter: new MockFamilyAdapter(mongoContract),
      driver: new MockSqlDriver([{ _id: '1' }]),
      verify: { mode: 'onFirstUse', requireMarker: false },
      middlewares: [telemetry],
    });

    for await (const _row of sqlRuntime.execute({
      sql: 'SELECT 1',
      params: [],
      meta: {
        target: 'postgres',
        storageHash: 'sha256:sql-hash',
        lane: 'sql',
        paramDescriptors: [],
      },
    })) {
      void _row;
    }

    for await (const _row of mongoRuntime.execute({
      sql: 'placeholder',
      params: [],
      meta: {
        target: 'mongo',
        storageHash: 'sha256:mongo-hash',
        lane: 'orm',
        paramDescriptors: [],
      },
    })) {
      void _row;
    }

    expect(telemetry.records).toHaveLength(4);
    expect(telemetry.records[0]).toMatchObject({ target: 'postgres', lane: 'sql' });
    expect(telemetry.records[1]).toMatchObject({ target: 'postgres', completed: true });
    expect(telemetry.records[2]).toMatchObject({ target: 'mongo', lane: 'orm' });
    expect(telemetry.records[3]).toMatchObject({ target: 'mongo', completed: true });
  });
});
