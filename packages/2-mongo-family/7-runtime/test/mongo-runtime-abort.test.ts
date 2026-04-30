import type { PlanMeta } from '@prisma-next/contract/types';
import type { CodecCallContext } from '@prisma-next/framework-components/codec';
import type { MongoAdapter, MongoDriver } from '@prisma-next/mongo-lowering';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import { describe, expect, it, vi } from 'vitest';
import { createMongoRuntime } from '../src/mongo-runtime';

const baseMeta: PlanMeta = {
  target: 'mongo',
  targetFamily: 'mongo',
  storageHash: 'sha256:test',
  lane: 'orm',
};

function createPlan(overrides?: Partial<MongoQueryPlan>): MongoQueryPlan {
  return {
    collection: 'users',
    command: { kind: 'find', filter: {} },
    meta: baseMeta,
    ...overrides,
  } as MongoQueryPlan;
}

interface RecordingAdapter {
  adapter: MongoAdapter;
  observed: Array<CodecCallContext | undefined>;
  callCount: { current: number };
}

function recordingAdapter(): RecordingAdapter {
  const observed: Array<CodecCallContext | undefined> = [];
  const callCount = { current: 0 };
  const adapter = {
    lower: vi.fn(async (plan: MongoQueryPlan, ctx?: CodecCallContext) => {
      callCount.current += 1;
      observed.push(ctx);
      return {
        collection: plan.collection,
        command: plan.command,
      };
    }),
  } as unknown as MongoAdapter;
  return { adapter, observed, callCount };
}

function rowsDriver(rows: Record<string, unknown>[] = []): MongoDriver {
  return {
    execute: vi.fn(async function* <Row>() {
      for (const row of rows) {
        yield row as Row;
      }
    }),
    close: vi.fn(async () => {}),
  } as unknown as MongoDriver;
}

async function drain(iter: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const row of iter) {
    out.push(row);
  }
  return out;
}

describe('MongoRuntime — execute(plan, options?) abort + ctx threading', () => {
  it('regression — execute(plan) with no options is bit-for-bit identical to today (adapter.lower sees undefined ctx)', async () => {
    const { adapter, observed } = recordingAdapter();
    const runtime = createMongoRuntime({
      adapter,
      driver: rowsDriver([{ _id: '1' }]),
      contract: {},
      targetId: 'mongo',
    });

    const rows = await drain(runtime.execute(createPlan()));
    expect(rows).toHaveLength(1);
    expect(observed).toEqual([undefined]);
  });

  it('regression — execute(plan, undefined) and execute(plan, {}) match the no-options shape (adapter.lower sees undefined ctx)', async () => {
    const { adapter, observed } = recordingAdapter();
    const runtime = createMongoRuntime({
      adapter,
      driver: rowsDriver([]),
      contract: {},
      targetId: 'mongo',
    });

    await drain(runtime.execute(createPlan(), undefined));
    await drain(runtime.execute(createPlan(), {}));
    expect(observed).toEqual([undefined, undefined]);
  });

  it('threads { signal } through execute → lower → adapter.lower as a CodecCallContext (signal identity preserved)', async () => {
    const { adapter, observed } = recordingAdapter();
    const runtime = createMongoRuntime({
      adapter,
      driver: rowsDriver([{ _id: '1' }]),
      contract: {},
      targetId: 'mongo',
    });

    const controller = new AbortController();
    await drain(runtime.execute(createPlan(), { signal: controller.signal }));

    expect(observed).toHaveLength(1);
    expect(observed[0]).toBeDefined();
    expect(observed[0]?.signal).toBe(controller.signal);
  });

  it('already-aborted signal at execute() entry rejects with RUNTIME.ABORTED { phase: stream } before any work (no adapter.lower, no driver.execute)', async () => {
    const { adapter, callCount } = recordingAdapter();
    const driver = rowsDriver([{ _id: '1' }]);
    const runtime = createMongoRuntime({
      adapter,
      driver,
      contract: {},
      targetId: 'mongo',
    });

    const controller = new AbortController();
    const reason = new Error('already aborted at runtime entry');
    controller.abort(reason);

    await expect(
      drain(runtime.execute(createPlan(), { signal: controller.signal })),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'stream' },
      cause: reason,
    });
    expect(callCount.current).toBe(0);
    expect(adapter.lower).not.toHaveBeenCalled();
    expect(
      (driver as unknown as { execute: { mock: { calls: unknown[] } } }).execute.mock.calls,
    ).toHaveLength(0);
  });
});
