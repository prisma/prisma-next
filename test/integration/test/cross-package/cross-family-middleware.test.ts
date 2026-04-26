import type { PlanMeta } from '@prisma-next/contract/types';
import type { ExecutionPlan } from '@prisma-next/framework-components/runtime';
import { createTelemetryMiddleware, type TelemetryEvent } from '@prisma-next/middleware-telemetry';
import type { MongoAdapter, MongoDriver } from '@prisma-next/mongo-lowering';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import { createMongoRuntime } from '@prisma-next/mongo-runtime';
import {
  createRuntimeCore,
  type MarkerReader,
  type MarkerStatement,
  type RuntimeFamilyAdapter,
} from '@prisma-next/runtime-executor';
import { describe, expect, it, vi } from 'vitest';

function collectingTelemetry() {
  const events: TelemetryEvent[] = [];
  const middleware = createTelemetryMiddleware({ onEvent: (e) => events.push(e) });
  return { middleware, events };
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
  return {
    collection: 'users',
    command: { kind: 'find', filter: {} },
    meta,
  } as unknown as MongoQueryPlan;
}

describe('cross-family middleware proof', () => {
  it('same middleware observes queries from an SQL runtime', async () => {
    const { middleware, events } = collectingTelemetry();

    const sqlContract: MockSqlContract = {
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:sql-test',
    };

    const sqlRuntime = createRuntimeCore({
      familyAdapter: new MockFamilyAdapter(sqlContract),
      driver: new MockSqlDriver([{ id: 1, name: 'Alice' }]),
      verify: { mode: 'onFirstUse', requireMarker: false },
      middleware: [middleware],
    });

    const sqlPlan: ExecutionPlan & {
      readonly sql: string;
      readonly params: readonly unknown[];
    } = {
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

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      phase: 'beforeExecute',
      lane: 'sql',
      target: 'postgres',
      storageHash: 'sha256:sql-test',
    });
    expect(events[1]).toMatchObject({
      phase: 'afterExecute',
      lane: 'sql',
      target: 'postgres',
      rowCount: 1,
      completed: true,
    });
  });

  it('same middleware observes queries from a Mongo runtime', async () => {
    const { middleware, events } = collectingTelemetry();

    const mongoRuntime = createMongoRuntime({
      adapter: createMockMongoAdapter(),
      driver: createMockMongoDriver([
        { _id: '1', name: 'Bob' },
        { _id: '2', name: 'Carol' },
      ]),
      contract: {},
      targetId: 'mongo',
      middleware: [middleware],
    });

    const plan = createMongoPlan(mongoMeta);

    for await (const _row of mongoRuntime.execute(plan)) {
      void _row;
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      phase: 'beforeExecute',
      lane: 'orm',
      target: 'mongo',
      storageHash: 'sha256:mongo-test',
    });
    expect(events[1]).toMatchObject({
      phase: 'afterExecute',
      rowCount: 2,
      completed: true,
    });
  });

  it('same middleware instance works across SQL and Mongo runtimes', async () => {
    const { middleware, events } = collectingTelemetry();

    const sqlContract: MockSqlContract = {
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:sql-hash',
    };

    const sqlRuntime = createRuntimeCore({
      familyAdapter: new MockFamilyAdapter(sqlContract),
      driver: new MockSqlDriver([{ id: 1 }]),
      verify: { mode: 'onFirstUse', requireMarker: false },
      middleware: [middleware],
    });

    const mongoRuntime = createMongoRuntime({
      adapter: createMockMongoAdapter(),
      driver: createMockMongoDriver([{ _id: '1' }]),
      contract: {},
      targetId: 'mongo',
      middleware: [middleware],
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

    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({ target: 'postgres', lane: 'sql' });
    expect(events[1]).toMatchObject({ target: 'postgres', completed: true });
    expect(events[2]).toMatchObject({ target: 'mongo', lane: 'orm' });
    expect(events[3]).toMatchObject({ target: 'mongo', completed: true });
  });
});
