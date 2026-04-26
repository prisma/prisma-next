import type { PlanMeta } from '@prisma-next/contract/types';
import type {
  ExecutionPlan,
  QueryPlan,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';
import { RuntimeCore } from '@prisma-next/framework-components/runtime';
import { describe, expect, it } from 'vitest';

/**
 * Cross-family demonstration: a fictional "mock" family extends the
 * canonical `RuntimeCore` base and inherits the middleware lifecycle
 * (`runBeforeCompile → lower → beforeExecute → runDriver → onRow →
 * afterExecute`) from `runWithMiddleware`. Confirms that the abstract
 * base is family-agnostic — i.e. SQL and Mongo are not the only families
 * that can plug in.
 *
 * This file evolved from a `RuntimeCoreImpl`-shaped mock-family test
 * landed by the cross-family middleware SPI project. Adapted in this
 * project's M2 to point at the new abstract base instead. See
 * `projects/cross-family-runtime-unification/plan.md` § Milestone 2.
 */

interface MockContract {
  readonly target: string;
  readonly storageHash: string;
}

interface MockPlan extends QueryPlan {
  readonly draftId: string;
}

interface MockExec extends ExecutionPlan {
  readonly compiledId: string;
}

class MockRuntime extends RuntimeCore<MockPlan, MockExec, RuntimeMiddleware<MockExec>> {
  readonly events: string[] = [];
  closeCalls = 0;

  constructor(
    middleware: ReadonlyArray<RuntimeMiddleware<MockExec>>,
    ctx: RuntimeMiddlewareContext,
    private readonly contract: MockContract,
    private readonly rows: ReadonlyArray<Record<string, unknown>>,
  ) {
    super({ middleware, ctx });
  }

  protected lower(plan: MockPlan): MockExec {
    if (plan.meta.target !== this.contract.target) {
      throw new Error(
        `Plan target ${plan.meta.target} does not match contract target ${this.contract.target}`,
      );
    }
    if (plan.meta.storageHash !== this.contract.storageHash) {
      throw new Error(
        `Plan storageHash ${plan.meta.storageHash} does not match contract storageHash ${this.contract.storageHash}`,
      );
    }
    return { compiledId: plan.draftId, meta: plan.meta };
  }

  protected runDriver(_exec: MockExec): AsyncIterable<Record<string, unknown>> {
    const rows = this.rows;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {
        for (const row of rows) {
          yield row;
        }
      },
    };
  }

  async close(): Promise<void> {
    this.closeCalls++;
  }
}

const ctx: RuntimeMiddlewareContext = {
  contract: {},
  mode: 'strict',
  now: () => Date.now(),
  log: { info: () => {}, warn: () => {}, error: () => {} },
};

const meta: PlanMeta = {
  target: 'mock',
  storageHash: 'sha256:test-core',
  lane: 'raw-sql',
  paramDescriptors: [],
};

describe('RuntimeCore with mock family', () => {
  it('executes plans without SQL dependencies', async () => {
    const contract: MockContract = { target: 'mock', storageHash: 'sha256:test-core' };
    const runtime = new MockRuntime([], ctx, contract, [{ id: 1, name: 'test' }]);

    const plan: MockPlan = { draftId: 'd-1', meta };

    const results = await runtime.execute(plan).toArray();

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ id: 1, name: 'test' });
  });

  it('rejects plans whose `lower` raises (cross-family pre-execution validation)', async () => {
    const contract: MockContract = { target: 'mock', storageHash: 'sha256:test-core' };
    const runtime = new MockRuntime([], ctx, contract, []);

    const invalidPlan: MockPlan = {
      draftId: 'd-2',
      meta: {
        target: 'other',
        storageHash: 'sha256:other-core',
        lane: 'raw-sql',
        paramDescriptors: [],
      },
    };

    await expect(runtime.execute(invalidPlan).toArray()).rejects.toThrow(
      'Plan target other does not match contract target mock',
    );
  });

  it('drives middleware hooks for any family', async () => {
    let beforeExecuteCalled = false;
    let onRowCalled = false;
    let afterExecuteCalled = false;

    const middleware: RuntimeMiddleware<MockExec> = {
      name: 'test-middleware',
      async beforeExecute() {
        beforeExecuteCalled = true;
      },
      async onRow() {
        onRowCalled = true;
      },
      async afterExecute() {
        afterExecuteCalled = true;
      },
    };

    const contract: MockContract = { target: 'mock', storageHash: 'sha256:test-core' };
    const runtime = new MockRuntime([middleware], ctx, contract, [{ id: 1 }]);

    await runtime.execute({ draftId: 'd-3', meta }).toArray();

    expect(beforeExecuteCalled).toBe(true);
    expect(onRowCalled).toBe(true);
    expect(afterExecuteCalled).toBe(true);
  });

  it('exposes `close()` for resource teardown', async () => {
    const contract: MockContract = { target: 'mock', storageHash: 'sha256:test-core' };
    const runtime = new MockRuntime([], ctx, contract, []);

    await expect(runtime.close()).resolves.toBeUndefined();
    expect(runtime.closeCalls).toBe(1);
  });
});
