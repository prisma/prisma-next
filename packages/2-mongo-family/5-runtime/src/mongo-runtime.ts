import type { PlanMeta } from '@prisma-next/contract/types';
import type {
  AnyMongoCommand,
  MongoAdapter,
  MongoDriver,
  MongoLoweringContext,
  MongoReadPlanLike,
} from '@prisma-next/mongo-core';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';

export interface MongoRuntimeOptions {
  readonly adapter: MongoAdapter;
  readonly driver: MongoDriver;
  readonly loweringContext: MongoLoweringContext;
}

export interface MongoRuntime {
  execute<Row>(plan: MongoReadPlanLike): AsyncIterableResult<Row>;
  executeCommand<Row>(command: AnyMongoCommand, meta: PlanMeta): AsyncIterableResult<Row>;
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

  execute<Row>(plan: MongoReadPlanLike): AsyncIterableResult<Row> {
    const wireCommand = this.#adapter.lowerReadPlan(plan);
    return this.#wrapIterable(this.#driver.execute<Row>(wireCommand));
  }

  executeCommand<Row>(command: AnyMongoCommand, _meta: PlanMeta): AsyncIterableResult<Row> {
    const wireCommand = this.#adapter.lowerCommand(command, this.#loweringContext);
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
