import type { PlanMeta } from '@prisma-next/contract/types';
import type {
  ExecutionPlan,
  QueryPlan,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';
import { RuntimeCore } from '@prisma-next/framework-components/runtime';
import { createTelemetryMiddleware, type TelemetryEvent } from '@prisma-next/middleware-telemetry';
import type { MongoAdapter, MongoDriver } from '@prisma-next/mongo-lowering';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import { createMongoRuntime } from '@prisma-next/mongo-runtime';
import { describe, expect, it, vi } from 'vitest';

function collectingTelemetry() {
  const events: TelemetryEvent[] = [];
  const middleware = createTelemetryMiddleware({ onEvent: (e) => events.push(e) });
  return { middleware, events };
}

interface MockSqlPlan extends QueryPlan {
  readonly sql: string;
  readonly params: readonly unknown[];
}

interface MockSqlExec extends ExecutionPlan {
  readonly sql: string;
  readonly params: readonly unknown[];
}

class MockSqlRuntime extends RuntimeCore<MockSqlPlan, MockSqlExec, RuntimeMiddleware<MockSqlExec>> {
  constructor(
    middleware: ReadonlyArray<RuntimeMiddleware<MockSqlExec>>,
    ctx: RuntimeMiddlewareContext,
    private readonly rows: ReadonlyArray<Record<string, unknown>>,
  ) {
    super({ middleware, ctx });
  }

  protected lower(plan: MockSqlPlan): MockSqlExec {
    return { sql: plan.sql, params: plan.params, meta: plan.meta };
  }

  protected runDriver(_exec: MockSqlExec): AsyncIterable<Record<string, unknown>> {
    const rows = this.rows;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {
        for (const row of rows) {
          yield row;
        }
      },
    };
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

const sqlCtx: RuntimeMiddlewareContext = {
  contract: {},
  mode: 'strict',
  now: () => Date.now(),
  log: { info: () => {}, warn: () => {}, error: () => {} },
  identityKey: () => 'mock-key',
};

describe('cross-family middleware proof', () => {
  it('same middleware observes queries from an SQL runtime', async () => {
    const { middleware, events } = collectingTelemetry();

    const sqlRuntime = new MockSqlRuntime([middleware], sqlCtx, [{ id: 1, name: 'Alice' }]);

    const sqlPlan: MockSqlPlan = {
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

    const sqlRuntime = new MockSqlRuntime([middleware], sqlCtx, [{ id: 1 }]);

    const mongoRuntime = createMongoRuntime({
      adapter: createMockMongoAdapter(),
      driver: createMockMongoDriver([{ _id: '1' }]),
      contract: {},
      targetId: 'mongo',
      middleware: [middleware],
    });

    const sqlPlan2: MockSqlPlan = {
      sql: 'SELECT 1',
      params: [],
      meta: {
        target: 'postgres',
        storageHash: 'sha256:sql-hash',
        lane: 'sql',
        paramDescriptors: [],
      },
    };

    for await (const _row of sqlRuntime.execute(sqlPlan2)) {
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
