import type { MongoAdapter, MongoDriver, MongoQueryPlanLike } from '@prisma-next/mongo-lowering';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';

export interface MongoRuntimeOptions {
  readonly adapter: MongoAdapter;
  readonly driver: MongoDriver;
}

export interface MongoRuntime {
  execute<Row>(plan: MongoQueryPlanLike): AsyncIterableResult<Row>;
  close(): Promise<void>;
}

class MongoRuntimeImpl implements MongoRuntime {
  readonly #adapter: MongoAdapter;
  readonly #driver: MongoDriver;

  constructor(options: MongoRuntimeOptions) {
    this.#adapter = options.adapter;
    this.#driver = options.driver;
  }

  execute<Row>(plan: MongoQueryPlanLike): AsyncIterableResult<Row> {
    const wireCommand = this.#adapter.lower(plan);
    return this.#wrapIterable(this.#driver.execute<Row>(wireCommand));
  }

  #wrapIterable<Row>(iterable: AsyncIterable<Row>): AsyncIterableResult<Row> {
    async function* toGenerator(): AsyncGenerator<Row, void, unknown> {
      yield* iterable;
    }
    return new AsyncIterableResult(toGenerator());
  }

  async close(): Promise<void> {
    await this.#driver.close();
  }
}

export function createMongoRuntime(options: MongoRuntimeOptions): MongoRuntime {
  return new MongoRuntimeImpl(options);
}
