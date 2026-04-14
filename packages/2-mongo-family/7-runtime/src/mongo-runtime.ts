import type {
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';
import {
  AsyncIterableResult,
  checkMiddlewareCompatibility,
} from '@prisma-next/framework-components/runtime';
import type { MongoAdapter, MongoDriver } from '@prisma-next/mongo-lowering';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';

export interface MongoRuntimeOptions {
  readonly adapter: MongoAdapter;
  readonly driver: MongoDriver;
  readonly contract?: unknown;
  readonly middlewares?: readonly RuntimeMiddleware[];
  readonly mode?: 'strict' | 'permissive';
}

export interface MongoRuntime {
  execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row>;
  close(): Promise<void>;
}

class MongoRuntimeImpl implements MongoRuntime {
  readonly #adapter: MongoAdapter;
  readonly #driver: MongoDriver;
  readonly #middlewares: readonly RuntimeMiddleware[];
  readonly #middlewareContext: RuntimeMiddlewareContext;

  constructor(options: MongoRuntimeOptions) {
    this.#adapter = options.adapter;
    this.#driver = options.driver;
    this.#middlewares = options.middlewares ?? [];

    if (options.middlewares) {
      for (const mw of options.middlewares) {
        checkMiddlewareCompatibility(mw, 'mongo');
      }
    }

    this.#middlewareContext = {
      contract: options.contract,
      mode: options.mode ?? 'strict',
      now: () => Date.now(),
      log: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };
  }

  execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
    const adapter = this.#adapter;
    const driver = this.#driver;
    const middlewares = this.#middlewares;
    const ctx = this.#middlewareContext;

    const iterator = async function* (): AsyncGenerator<Row, void, unknown> {
      const startedAt = Date.now();
      let rowCount = 0;
      let completed = false;

      try {
        for (const mw of middlewares) {
          if (mw.beforeExecute) {
            await mw.beforeExecute(plan, ctx);
          }
        }

        const wireCommand = adapter.lower(plan);

        for await (const row of driver.execute<Row>(wireCommand)) {
          for (const mw of middlewares) {
            if (mw.onRow) {
              await mw.onRow(row as Record<string, unknown>, plan, ctx);
            }
          }
          rowCount++;
          yield row;
        }

        completed = true;
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        for (const mw of middlewares) {
          if (mw.afterExecute) {
            try {
              await mw.afterExecute(plan, { rowCount, latencyMs, completed }, ctx);
            } catch {
              // Ignore errors from afterExecute during error handling
            }
          }
        }
        throw error;
      }

      const latencyMs = Date.now() - startedAt;
      for (const mw of middlewares) {
        if (mw.afterExecute) {
          await mw.afterExecute(plan, { rowCount, latencyMs, completed }, ctx);
        }
      }
    };

    return new AsyncIterableResult(iterator());
  }

  async close(): Promise<void> {
    await this.#driver.close();
  }
}

export function createMongoRuntime(options: MongoRuntimeOptions): MongoRuntime {
  return new MongoRuntimeImpl(options);
}
