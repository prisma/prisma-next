import type { PlanMeta } from '@prisma-next/contract/types';
import type { RuntimeMiddleware } from '@prisma-next/framework-components/runtime';
import type { MongoAdapter, MongoDriver } from '@prisma-next/mongo-lowering';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import { describe, expect, it, vi } from 'vitest';
import { createMongoRuntime } from '../src/mongo-runtime';

const baseMeta: PlanMeta = {
  target: 'mongo',
  targetFamily: 'mongo',
  storageHash: 'sha256:test',
  lane: 'orm',
  paramDescriptors: [],
};

function createPlan(overrides?: Partial<MongoQueryPlan>): MongoQueryPlan {
  return {
    collection: 'users',
    command: { kind: 'find', filter: {} },
    meta: baseMeta,
    ...overrides,
  } as MongoQueryPlan;
}

function createMockAdapter(): MongoAdapter {
  return {
    lower: vi.fn((plan: MongoQueryPlan) => ({
      collection: plan.collection,
      command: plan.command,
    })),
  } as unknown as MongoAdapter;
}

function createMockDriver(rows: Record<string, unknown>[] = []): MongoDriver {
  return {
    execute: vi.fn(async function* <Row>() {
      for (const row of rows) {
        yield row as Row;
      }
    }),
    close: vi.fn(async () => {}),
  } as unknown as MongoDriver;
}

describe('MongoRuntime middleware lifecycle', () => {
  it('calls beforeExecute, onRow, afterExecute in order', async () => {
    const callOrder: string[] = [];
    const middleware: RuntimeMiddleware = {
      name: 'test',
      async beforeExecute() {
        callOrder.push('beforeExecute');
      },
      async onRow() {
        callOrder.push('onRow');
      },
      async afterExecute() {
        callOrder.push('afterExecute');
      },
    };

    const runtime = createMongoRuntime({
      adapter: createMockAdapter(),
      driver: createMockDriver([{ _id: '1', name: 'Alice' }]),
      contract: {},
      middlewares: [middleware],
    });

    const plan = createPlan();
    for await (const _row of runtime.execute(plan)) {
      void _row;
    }

    expect(callOrder).toEqual(['beforeExecute', 'onRow', 'afterExecute']);
  });

  it('works with no middlewares', async () => {
    const runtime = createMongoRuntime({
      adapter: createMockAdapter(),
      driver: createMockDriver([{ _id: '1' }]),
      contract: {},
    });

    const results: unknown[] = [];
    for await (const row of runtime.execute(createPlan())) {
      results.push(row);
    }

    expect(results).toHaveLength(1);
  });

  it('passes plan metadata to middleware hooks', async () => {
    const receivedMeta: PlanMeta[] = [];
    const middleware: RuntimeMiddleware = {
      name: 'meta-inspector',
      async beforeExecute(plan) {
        receivedMeta.push(plan.meta);
      },
    };

    const runtime = createMongoRuntime({
      adapter: createMockAdapter(),
      driver: createMockDriver([]),
      contract: {},
      middlewares: [middleware],
    });

    const plan = createPlan();
    for await (const _row of runtime.execute(plan)) {
      void _row;
    }

    expect(receivedMeta).toHaveLength(1);
    expect(receivedMeta[0]!.target).toBe('mongo');
    expect(receivedMeta[0]!.lane).toBe('orm');
  });

  it('calls afterExecute with completed: false on error, then rethrows', async () => {
    const failingDriver = {
      execute: vi.fn(async function* () {
        yield* []; // satisfy generator contract before throwing
        throw new Error('driver failure');
      }),
      close: vi.fn(async () => {}),
    } as unknown as MongoDriver;

    let afterResult: { completed: boolean; rowCount: number } | undefined;
    const middleware: RuntimeMiddleware = {
      name: 'error-observer',
      async afterExecute(_plan, result) {
        afterResult = { completed: result.completed, rowCount: result.rowCount };
      },
    };

    const runtime = createMongoRuntime({
      adapter: createMockAdapter(),
      driver: failingDriver,
      contract: {},
      middlewares: [middleware],
    });

    await expect(async () => {
      for await (const _row of runtime.execute(createPlan())) {
        void _row;
      }
    }).rejects.toThrow('driver failure');

    expect(afterResult).toEqual({ completed: false, rowCount: 0 });
  });

  it('reports correct rowCount and completed: true on success', async () => {
    let afterResult: { completed: boolean; rowCount: number } | undefined;
    const middleware: RuntimeMiddleware = {
      name: 'result-observer',
      async afterExecute(_plan, result) {
        afterResult = { completed: result.completed, rowCount: result.rowCount };
      },
    };

    const runtime = createMongoRuntime({
      adapter: createMockAdapter(),
      driver: createMockDriver([{ _id: '1' }, { _id: '2' }, { _id: '3' }]),
      contract: {},
      middlewares: [middleware],
    });

    for await (const _row of runtime.execute(createPlan())) {
      void _row;
    }

    expect(afterResult).toEqual({ completed: true, rowCount: 3 });
  });
});

describe('MongoRuntime middleware compatibility validation', () => {
  it('accepts a generic middleware (no familyId)', () => {
    const middleware: RuntimeMiddleware = { name: 'generic' };
    expect(() =>
      createMongoRuntime({
        adapter: createMockAdapter(),
        driver: createMockDriver(),
        contract: {},
        middlewares: [middleware],
      }),
    ).not.toThrow();
  });

  it('accepts a mongo middleware', () => {
    const middleware: RuntimeMiddleware = { name: 'mongo-specific', familyId: 'mongo' };
    expect(() =>
      createMongoRuntime({
        adapter: createMockAdapter(),
        driver: createMockDriver(),
        contract: {},
        middlewares: [middleware],
      }),
    ).not.toThrow();
  });

  it('rejects a SQL middleware with a clear error', () => {
    const middleware: RuntimeMiddleware = { name: 'sql-lints', familyId: 'sql' };
    expect(() =>
      createMongoRuntime({
        adapter: createMockAdapter(),
        driver: createMockDriver(),
        contract: {},
        middlewares: [middleware],
      }),
    ).toThrow(
      "Middleware 'sql-lints' requires family 'sql' but the runtime is configured for family 'mongo'",
    );
  });
});
