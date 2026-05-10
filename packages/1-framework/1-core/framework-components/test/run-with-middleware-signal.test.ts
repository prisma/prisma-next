import type { PlanMeta } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import type { ExecutionPlan } from '../src/execution/query-plan';
import { runWithMiddleware } from '../src/execution/run-with-middleware';
import type {
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '../src/execution/runtime-middleware';

const meta: PlanMeta = {
  target: 'mock',
  storageHash: 'sha256:test',
  lane: 'raw-sql',
};

interface MockExec extends ExecutionPlan {
  readonly id: string;
}

const mockExec: MockExec = { id: 'exec-1', meta };

function makeCtx(signal?: AbortSignal): RuntimeMiddlewareContext {
  return {
    contract: {},
    mode: 'strict',
    now: () => Date.now(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    contentHash: async () => 'mock-content-hash',
    ...(signal ? { signal } : {}),
  };
}

async function* yieldRows<R>(rows: ReadonlyArray<R>): AsyncGenerator<R, void, unknown> {
  for (const row of rows) {
    yield row;
  }
}

describe('RuntimeMiddlewareContext.signal', () => {
  it('ctx.signal is the exact same reference at every middleware phase', async () => {
    const controller = new AbortController();
    const ctx = makeCtx(controller.signal);
    const observed: AbortSignal[] = [];

    const mw: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async beforeExecute(_plan, c) {
        if (c.signal) observed.push(c.signal);
      },
      async onRow(_row, _plan, c) {
        if (c.signal) observed.push(c.signal);
      },
      async afterExecute(_plan, _result, c) {
        if (c.signal) observed.push(c.signal);
      },
    };

    const result = runWithMiddleware<MockExec, Record<string, unknown>>(mockExec, [mw], ctx, () =>
      yieldRows([{ id: 1 }]),
    );
    await result.toArray();

    expect(observed).toHaveLength(3);
    expect(observed[0]).toBe(controller.signal);
    expect(observed[1]).toBe(controller.signal);
    expect(observed[2]).toBe(controller.signal);
  });

  it('ctx.signal is undefined when no signal was supplied', async () => {
    const ctx = makeCtx(undefined);
    let observedSignal: AbortSignal | undefined = new AbortController().signal;

    const mw: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async beforeExecute(_plan, c) {
        observedSignal = c.signal;
      },
    };

    const result = runWithMiddleware<MockExec, Record<string, unknown>>(mockExec, [mw], ctx, () =>
      yieldRows([{ id: 1 }]),
    );
    await result.toArray();

    expect(observedSignal).toBeUndefined();
  });
});
