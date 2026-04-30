import type { CodecCallContext } from '@prisma-next/framework-components/codec';
import type {
  AsyncIterableResult,
  RuntimeExecuteOptions,
} from '@prisma-next/framework-components/runtime';
import {
  checkMiddlewareCompatibility,
  RuntimeCore,
} from '@prisma-next/framework-components/runtime';
import type { MongoAdapter, MongoDriver } from '@prisma-next/mongo-lowering';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import type { MongoExecutionPlan } from './mongo-execution-plan';
import type { MongoMiddleware, MongoMiddlewareContext } from './mongo-middleware';

function noop() {}

export interface MongoRuntimeOptions {
  readonly adapter: MongoAdapter;
  readonly driver: MongoDriver;
  readonly contract: unknown;
  readonly targetId: string;
  readonly middleware?: readonly MongoMiddleware[];
  readonly mode?: 'strict' | 'permissive';
}

export interface MongoRuntime {
  /**
   * Execute a `MongoQueryPlan` and return an async iterable of rows.
   *
   * The optional `options.signal` is threaded through
   * `lower → adapter.lower → resolveValue → codec.encode` so codec authors
   * who forward the signal to their underlying SDK get true cancellation
   * of in-flight network calls. The runtime additionally observes the
   * signal at two boundaries:
   *
   * - **Already-aborted at entry** — first `next()` throws
   *   `RUNTIME.ABORTED { phase: 'stream' }` before any work is done.
   *   (Inherited from `RuntimeCore.execute`.)
   * - **Mid-encode abort** — surfaces as
   *   `RUNTIME.ABORTED { phase: 'encode' }` from inside `resolveValue`'s
   *   per-level `Promise.all` race.
   *
   * Mongo's read path does not go through codecs (per ADR 204), so there
   * is no `phase: 'decode'` boundary on the Mongo side.
   */
  execute<Row>(
    plan: MongoQueryPlan<Row>,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row>;
  close(): Promise<void>;
}

class MongoRuntimeImpl
  extends RuntimeCore<MongoQueryPlan, MongoExecutionPlan, MongoMiddleware>
  implements MongoRuntime
{
  readonly #adapter: MongoAdapter;
  readonly #driver: MongoDriver;

  constructor(options: MongoRuntimeOptions) {
    const middleware = options.middleware ? [...options.middleware] : [];
    for (const mw of middleware) {
      checkMiddlewareCompatibility(mw, 'mongo', options.targetId);
    }

    const ctx: MongoMiddlewareContext = {
      contract: options.contract,
      mode: options.mode ?? 'strict',
      now: () => Date.now(),
      log: { info: noop, warn: noop, error: noop },
    };

    super({ middleware, ctx });

    this.#adapter = options.adapter;
    this.#driver = options.driver;
  }

  protected override async lower(
    plan: MongoQueryPlan,
    ctx?: CodecCallContext,
  ): Promise<MongoExecutionPlan> {
    return {
      command: await this.#adapter.lower(plan, ctx),
      meta: plan.meta,
    };
  }

  protected override runDriver(exec: MongoExecutionPlan): AsyncIterable<Record<string, unknown>> {
    return this.#driver.execute<Record<string, unknown>>(exec.command);
  }

  override async close(): Promise<void> {
    await this.#driver.close();
  }
}

export function createMongoRuntime(options: MongoRuntimeOptions): MongoRuntime {
  return new MongoRuntimeImpl(options);
}
