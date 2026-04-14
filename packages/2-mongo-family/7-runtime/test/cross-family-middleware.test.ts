import type { ExecutionPlan, PlanMeta } from '@prisma-next/contract/types';
import type {
  AfterExecuteResult,
  RuntimeMiddleware,
} from '@prisma-next/framework-components/runtime';
import type { MongoAdapter, MongoDriver } from '@prisma-next/mongo-lowering';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import {
  createRuntimeCore,
  type MarkerReader,
  type MarkerStatement,
  type RuntimeFamilyAdapter,
} from '@prisma-next/runtime-executor';
import { describe, expect, it, vi } from 'vitest';
import { createMongoRuntime } from '../src/mongo-runtime';

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

interface MockSqlContract {
  readonly target: string;
  readonly targetFamily: string;
  readonly storageHash: string;
}

class MockFamilyAdapter implements RuntimeFamilyAdapter<MockSqlContract> {
  readonly contract: MockSqlContract;
  readonly markerReader: MarkerReader;

  constructor(contract: MockSqlContract) {
    this.contract = contract;
    this.markerReader = new MockMarkerReader();
  }

  validatePlan(_plan: ExecutionPlan, _contract: MockSqlContract): void {}
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

function createMockMongoAdapter(): MongoAdapter {
  return {
    lower: vi.fn((plan: MongoQueryPlan) => ({
      collection: plan.collection,
      command: plan.command,
    })),
  } as unknown as MongoAdapter;
}

function createMockMongoDriver(rows: Record<string, unknown>[] = []): MongoDriver {
  return {
    execute: vi.fn(async function* <Row>() {
      for (const row of rows) {
        yield row as Row;
      }
    }),
    close: vi.fn(async () => {}),
  } as unknown as MongoDriver;
}

const mongoMeta: PlanMeta = {
  target: 'mongo',
  targetFamily: 'mongo',
  storageHash: 'sha256:mongo-test',
  lane: 'orm',
  paramDescriptors: [],
};

function createMongoPlan(meta: PlanMeta = mongoMeta): MongoQueryPlan {
  // MongoQueryPlan has a complex command union; safe to bypass for test mocks
  return {
    collection: 'users',
    command: { kind: 'find', filter: {} },
    meta,
  } as unknown as MongoQueryPlan;
}

describe('cross-family middleware proof', () => {
  it('same middleware observes queries from an SQL runtime', async () => {
    const telemetry = createTelemetryMiddleware();

    const sqlContract: MockSqlContract = {
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

  it('same middleware observes queries from a Mongo runtime', async () => {
    const telemetry = createTelemetryMiddleware();

    const mongoRuntime = createMongoRuntime({
      adapter: createMockMongoAdapter(),
      driver: createMockMongoDriver([
        { _id: '1', name: 'Bob' },
        { _id: '2', name: 'Carol' },
      ]),
      middlewares: [telemetry],
    });

    const plan = createMongoPlan(mongoMeta);

    for await (const _row of mongoRuntime.execute(plan)) {
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

  it('same middleware instance works across SQL and Mongo runtimes', async () => {
    const telemetry = createTelemetryMiddleware();

    const sqlContract: MockSqlContract = {
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:sql-hash',
    };

    const sqlRuntime = createRuntimeCore({
      familyAdapter: new MockFamilyAdapter(sqlContract),
      driver: new MockSqlDriver([{ id: 1 }]),
      verify: { mode: 'onFirstUse', requireMarker: false },
      middlewares: [telemetry],
    });

    const mongoRuntime = createMongoRuntime({
      adapter: createMockMongoAdapter(),
      driver: createMockMongoDriver([{ _id: '1' }]),
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

    const mongoPlan = createMongoPlan({
      target: 'mongo',
      targetFamily: 'mongo',
      storageHash: 'sha256:mongo-hash',
      lane: 'orm',
      paramDescriptors: [],
    });

    for await (const _row of mongoRuntime.execute(mongoPlan)) {
      void _row;
    }

    expect(telemetry.records).toHaveLength(4);
    expect(telemetry.records[0]).toMatchObject({ target: 'postgres', lane: 'sql' });
    expect(telemetry.records[1]).toMatchObject({ target: 'postgres', completed: true });
    expect(telemetry.records[2]).toMatchObject({ target: 'mongo', lane: 'orm' });
    expect(telemetry.records[3]).toMatchObject({ target: 'mongo', completed: true });
  });
});
