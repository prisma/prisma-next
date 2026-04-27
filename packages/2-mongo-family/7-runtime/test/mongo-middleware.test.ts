import type { PlanMeta } from '@prisma-next/contract/types';
import type { MongoAdapter, MongoDriver } from '@prisma-next/mongo-lowering';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import { describe, expect, it, vi } from 'vitest';
import type { MongoMiddleware } from '../src/mongo-middleware';
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
    const middleware: MongoMiddleware = {
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
      targetId: 'mongo',
      middleware: [middleware],
    });

    const plan = createPlan();
    for await (const _row of runtime.execute(plan)) {
      void _row;
    }

    expect(callOrder).toEqual(['beforeExecute', 'onRow', 'afterExecute']);
  });

  it('works with no middleware', async () => {
    const runtime = createMongoRuntime({
      adapter: createMockAdapter(),
      driver: createMockDriver([{ _id: '1' }]),
      contract: {},
      targetId: 'mongo',
    });

    const results: unknown[] = [];
    for await (const row of runtime.execute(createPlan())) {
      results.push(row);
    }

    expect(results).toHaveLength(1);
  });

  it('passes plan metadata to middleware hooks', async () => {
    const receivedMeta: PlanMeta[] = [];
    const middleware: MongoMiddleware = {
      name: 'meta-inspector',
      async beforeExecute(plan) {
        receivedMeta.push(plan.meta);
      },
    };

    const runtime = createMongoRuntime({
      adapter: createMockAdapter(),
      driver: createMockDriver([]),
      contract: {},
      targetId: 'mongo',
      middleware: [middleware],
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
    const middleware: MongoMiddleware = {
      name: 'error-observer',
      async afterExecute(_plan, result) {
        afterResult = { completed: result.completed, rowCount: result.rowCount };
      },
    };

    const runtime = createMongoRuntime({
      adapter: createMockAdapter(),
      driver: failingDriver,
      contract: {},
      targetId: 'mongo',
      middleware: [middleware],
    });

    await expect(async () => {
      for await (const _row of runtime.execute(createPlan())) {
        void _row;
      }
    }).rejects.toThrow('driver failure');

    expect(afterResult).toEqual({ completed: false, rowCount: 0 });
  });

  it('handles error path with middleware that has no afterExecute', async () => {
    const failingDriver = {
      execute: vi.fn(async function* () {
        yield* [];
        throw new Error('driver failure');
      }),
      close: vi.fn(async () => {}),
    } as unknown as MongoDriver;

    const beforeCalled = vi.fn();
    const middleware: MongoMiddleware = {
      name: 'no-afterExecute',
      async beforeExecute() {
        beforeCalled();
      },
    };

    const runtime = createMongoRuntime({
      adapter: createMockAdapter(),
      driver: failingDriver,
      contract: {},
      targetId: 'mongo',
      middleware: [middleware],
    });

    await expect(async () => {
      for await (const _row of runtime.execute(createPlan())) {
        void _row;
      }
    }).rejects.toThrow('driver failure');

    expect(beforeCalled).toHaveBeenCalledOnce();
  });

  it('swallows afterExecute errors during error handling and rethrows the original', async () => {
    const failingDriver = {
      execute: vi.fn(async function* () {
        yield* [];
        throw new Error('driver failure');
      }),
      close: vi.fn(async () => {}),
    } as unknown as MongoDriver;

    const middleware: MongoMiddleware = {
      name: 'failing-afterExecute',
      async afterExecute() {
        throw new Error('afterExecute also fails');
      },
    };

    const runtime = createMongoRuntime({
      adapter: createMockAdapter(),
      driver: failingDriver,
      contract: {},
      targetId: 'mongo',
      middleware: [middleware],
    });

    await expect(async () => {
      for await (const _row of runtime.execute(createPlan())) {
        void _row;
      }
    }).rejects.toThrow('driver failure');
  });

  it('reports correct rowCount and completed: true on success', async () => {
    let afterResult: { completed: boolean; rowCount: number } | undefined;
    const middleware: MongoMiddleware = {
      name: 'result-observer',
      async afterExecute(_plan, result) {
        afterResult = { completed: result.completed, rowCount: result.rowCount };
      },
    };

    const runtime = createMongoRuntime({
      adapter: createMockAdapter(),
      driver: createMockDriver([{ _id: '1' }, { _id: '2' }, { _id: '3' }]),
      contract: {},
      targetId: 'mongo',
      middleware: [middleware],
    });

    for await (const _row of runtime.execute(createPlan())) {
      void _row;
    }

    expect(afterResult).toEqual({ completed: true, rowCount: 3 });
  });

  it('passes mode through to middleware context', async () => {
    let receivedMode: string | undefined;
    const middleware: MongoMiddleware = {
      name: 'mode-inspector',
      async beforeExecute(_plan, ctx) {
        receivedMode = ctx.mode;
      },
    };

    const runtime = createMongoRuntime({
      adapter: createMockAdapter(),
      driver: createMockDriver([]),
      contract: {},
      targetId: 'mongo',
      middleware: [middleware],
      mode: 'permissive',
    });

    for await (const _row of runtime.execute(createPlan())) {
      void _row;
    }

    expect(receivedMode).toBe('permissive');
  });

  it('provides working log and now on the middleware context', async () => {
    let logWorks = false;
    const middleware: MongoMiddleware = {
      name: 'ctx-tester',
      async beforeExecute(_plan, ctx) {
        ctx.log.info('test');
        ctx.log.warn('test');
        ctx.log.error('test');
        ctx.now();
        logWorks = true;
      },
    };

    const runtime = createMongoRuntime({
      adapter: createMockAdapter(),
      driver: createMockDriver([]),
      contract: {},
      targetId: 'mongo',
      middleware: [middleware],
    });

    for await (const _row of runtime.execute(createPlan())) {
      void _row;
    }

    expect(logWorks).toBe(true);
  });
});

describe('MongoRuntime middleware compatibility validation', () => {
  it('accepts a generic middleware (no familyId)', () => {
    const middleware: MongoMiddleware = { name: 'generic' };
    expect(() =>
      createMongoRuntime({
        adapter: createMockAdapter(),
        driver: createMockDriver(),
        contract: {},
        targetId: 'mongo',
        middleware: [middleware],
      }),
    ).not.toThrow();
  });

  it('accepts a mongo middleware', () => {
    const middleware: MongoMiddleware = { name: 'mongo-specific', familyId: 'mongo' };
    expect(() =>
      createMongoRuntime({
        adapter: createMockAdapter(),
        driver: createMockDriver(),
        contract: {},
        targetId: 'mongo',
        middleware: [middleware],
      }),
    ).not.toThrow();
  });

  it('rejects a SQL middleware with a clear error', () => {
    // Intentionally misconfigured to verify the runtime rejects mismatched familyId.
    // The static type narrows familyId to 'mongo' | undefined, so we cast to bypass
    // the type check and exercise the runtime path.
    const middleware = {
      name: 'sql-lints',
      familyId: 'sql' as const,
    } as unknown as MongoMiddleware;
    expect(() =>
      createMongoRuntime({
        adapter: createMockAdapter(),
        driver: createMockDriver(),
        contract: {},
        targetId: 'mongo',
        middleware: [middleware],
      }),
    ).toThrow(
      "Middleware 'sql-lints' requires family 'sql' but the runtime is configured for family 'mongo'",
    );
  });
});
