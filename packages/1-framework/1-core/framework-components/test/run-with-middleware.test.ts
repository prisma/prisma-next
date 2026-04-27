import type { PlanMeta } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import type { ExecutionPlan } from '../src/query-plan';
import { runWithMiddleware } from '../src/run-with-middleware';
import type {
  AfterExecuteResult,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '../src/runtime-middleware';

const meta: PlanMeta = {
  target: 'mock',
  storageHash: 'sha256:test',
  lane: 'raw-sql',
  paramDescriptors: [],
};

interface MockExec extends ExecutionPlan {
  readonly id: string;
}

const mockExec: MockExec = { id: 'exec-1', meta };

const mockCtx: RuntimeMiddlewareContext = {
  contract: {},
  mode: 'strict',
  now: () => Date.now(),
  log: { info: () => {}, warn: () => {}, error: () => {} },
  identityKey: () => 'mock-key',
};

async function* yieldRows<R>(rows: ReadonlyArray<R>): AsyncGenerator<R, void, unknown> {
  for (const row of rows) {
    yield row;
  }
}

describe('runWithMiddleware', () => {
  it('zero middleware passes driver rows through unchanged', async () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];

    const result = runWithMiddleware<MockExec, Record<string, unknown>>(mockExec, [], mockCtx, () =>
      yieldRows(rows),
    );

    const out = await result.toArray();
    expect(out).toEqual(rows);
  });

  it('single middleware sees beforeExecute, onRow per row, then afterExecute(completed: true)', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const events: string[] = [];
    let observedResult: AfterExecuteResult | undefined;

    const mw: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async beforeExecute(plan, ctx) {
        expect(plan).toBe(mockExec);
        expect(ctx).toBe(mockCtx);
        events.push('beforeExecute');
      },
      async onRow(row) {
        events.push(`onRow:${(row as { id: number }).id}`);
      },
      async afterExecute(plan, result, ctx) {
        expect(plan).toBe(mockExec);
        expect(ctx).toBe(mockCtx);
        observedResult = result;
        events.push('afterExecute');
      },
    };

    const result = runWithMiddleware<MockExec, Record<string, unknown>>(
      mockExec,
      [mw],
      mockCtx,
      () => yieldRows(rows),
    );

    const out = await result.toArray();

    expect(out).toEqual(rows);
    expect(events).toEqual(['beforeExecute', 'onRow:1', 'onRow:2', 'afterExecute']);
    expect(observedResult).toMatchObject({ rowCount: 2, completed: true, source: 'driver' });
    expect(observedResult?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('multiple middleware run in registration order at every hook site', async () => {
    const rows = [{ id: 'a' }];
    const events: string[] = [];

    function mw(label: string): RuntimeMiddleware<MockExec> {
      return {
        name: label,
        async beforeExecute() {
          events.push(`${label}:beforeExecute`);
        },
        async onRow() {
          events.push(`${label}:onRow`);
        },
        async afterExecute() {
          events.push(`${label}:afterExecute`);
        },
      };
    }

    const result = runWithMiddleware<MockExec, Record<string, unknown>>(
      mockExec,
      [mw('A'), mw('B'), mw('C')],
      mockCtx,
      () => yieldRows(rows),
    );

    await result.toArray();

    expect(events).toEqual([
      'A:beforeExecute',
      'B:beforeExecute',
      'C:beforeExecute',
      'A:onRow',
      'B:onRow',
      'C:onRow',
      'A:afterExecute',
      'B:afterExecute',
      'C:afterExecute',
    ]);
  });

  it('error path: driver throw triggers afterExecute(completed: false) for each middleware in order then rethrows', async () => {
    const events: string[] = [];
    const observed: Array<{ label: string; completed: boolean; rowCount: number }> = [];
    const driverError = new Error('driver boom');

    function mw(label: string): RuntimeMiddleware<MockExec> {
      return {
        name: label,
        async beforeExecute() {
          events.push(`${label}:beforeExecute`);
        },
        async afterExecute(_plan, result) {
          observed.push({ label, completed: result.completed, rowCount: result.rowCount });
          events.push(`${label}:afterExecute`);
        },
      };
    }

    const failingDriver = async function* (): AsyncGenerator<
      Record<string, unknown>,
      void,
      unknown
    > {
      yield { id: 1 };
      throw driverError;
    };

    const result = runWithMiddleware<MockExec, Record<string, unknown>>(
      mockExec,
      [mw('A'), mw('B')],
      mockCtx,
      failingDriver,
    );

    await expect(result.toArray()).rejects.toBe(driverError);

    expect(events).toEqual([
      'A:beforeExecute',
      'B:beforeExecute',
      'A:afterExecute',
      'B:afterExecute',
    ]);
    expect(observed).toEqual([
      { label: 'A', completed: false, rowCount: 1 },
      { label: 'B', completed: false, rowCount: 1 },
    ]);
  });

  it('error inside afterExecute during error path is swallowed and the original driver error is rethrown', async () => {
    const driverError = new Error('driver boom');
    const afterExecuteError = new Error('afterExecute boom');
    const events: string[] = [];

    const noisy: RuntimeMiddleware<MockExec> = {
      name: 'noisy',
      async afterExecute() {
        events.push('noisy:afterExecute');
        throw afterExecuteError;
      },
    };
    const tail: RuntimeMiddleware<MockExec> = {
      name: 'tail',
      async afterExecute() {
        events.push('tail:afterExecute');
      },
    };

    const failingDriver: () => AsyncIterable<Record<string, unknown>> = () => ({
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<Record<string, unknown>>> {
            return Promise.reject(driverError);
          },
        };
      },
    });

    const result = runWithMiddleware<MockExec, Record<string, unknown>>(
      mockExec,
      [noisy, tail],
      mockCtx,
      failingDriver,
    );

    await expect(result.toArray()).rejects.toBe(driverError);

    expect(events).toEqual(['noisy:afterExecute', 'tail:afterExecute']);
  });

  it('skips hooks that the middleware does not implement', async () => {
    const rows = [{ id: 1 }];
    const events: string[] = [];

    const partial: RuntimeMiddleware<MockExec> = {
      name: 'partial',
      async onRow() {
        events.push('onRow');
      },
    };

    const result = runWithMiddleware<MockExec, Record<string, unknown>>(
      mockExec,
      [partial],
      mockCtx,
      () => yieldRows(rows),
    );

    await result.toArray();
    expect(events).toEqual(['onRow']);
  });
});
