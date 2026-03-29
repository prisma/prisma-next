import type {
  MongoAdapter,
  MongoDriver,
  MongoLoweringContext,
  MongoQueryPlan,
} from '@prisma-next/mongo-core';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';

export interface MongoRuntimeOptions {
  readonly adapter: MongoAdapter;
  readonly driver: MongoDriver;
  readonly loweringContext: MongoLoweringContext;
}

export interface MongoRuntime {
  execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row>;
  close(): Promise<void>;
}

class MongoRuntimeImpl implements MongoRuntime {
  readonly #adapter: MongoAdapter;
  readonly #driver: MongoDriver;
  readonly #loweringContext: MongoLoweringContext;

  constructor(options: MongoRuntimeOptions) {
    this.#adapter = options.adapter;
    this.#driver = options.driver;
    this.#loweringContext = options.loweringContext;
  }

  execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
    const executionPlan = this.#adapter.lower(plan, this.#loweringContext);
    const iterable = this.#driver.execute<Row>(executionPlan.wireCommand);

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
