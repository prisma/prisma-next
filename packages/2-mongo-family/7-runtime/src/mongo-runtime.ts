import type { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
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
  execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row>;
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

  protected override async lower(plan: MongoQueryPlan): Promise<MongoExecutionPlan> {
    return {
      command: await this.#adapter.lower(plan),
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
