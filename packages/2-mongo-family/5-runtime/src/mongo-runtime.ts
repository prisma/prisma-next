import type {
  MongoAdapter,
  MongoDriver,
  MongoExecutionPlan,
  MongoLoweringContext,
  MongoQueryPlan,
} from '@prisma-next/mongo-core';
import { AggregateCommand, AggregateWireCommand } from '@prisma-next/mongo-core';
import type { MongoReadPlan } from '@prisma-next/mongo-query-ast';
import { lowerPipeline } from '@prisma-next/mongo-query-ast';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';

export type MongoAnyPlan<Row = unknown> = MongoQueryPlan<Row> | MongoReadPlan<Row>;

export interface MongoRuntimeOptions {
  readonly adapter: MongoAdapter;
  readonly driver: MongoDriver;
  readonly loweringContext: MongoLoweringContext;
}

export interface MongoRuntime {
  execute<Row>(plan: MongoAnyPlan<Row>): AsyncIterableResult<Row>;
  close(): Promise<void>;
}

function isReadPlan<Row>(plan: MongoAnyPlan<Row>): plan is MongoReadPlan<Row> {
  return 'stages' in plan;
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

  execute<Row>(plan: MongoAnyPlan<Row>): AsyncIterableResult<Row> {
    const executionPlan = isReadPlan(plan)
      ? this.#lowerReadPlan(plan)
      : this.#adapter.lower(plan, this.#loweringContext);
    const iterable = this.#driver.execute<Row>(executionPlan.wireCommand);

    async function* toGenerator(): AsyncGenerator<Row, void, unknown> {
      yield* iterable;
    }

    return new AsyncIterableResult(toGenerator());
  }

  #lowerReadPlan<Row>(plan: MongoReadPlan<Row>): MongoExecutionPlan<Row> {
    const loweredPipeline = lowerPipeline(plan.stages);
    const wireCommand = new AggregateWireCommand(plan.collection, loweredPipeline);
    const command = new AggregateCommand(plan.collection, loweredPipeline);
    return Object.freeze({ wireCommand, command, meta: plan.meta });
  }

  async close(): Promise<void> {
    await this.#driver.close();
  }
}

export function createMongoRuntime(options: MongoRuntimeOptions): MongoRuntime {
  return new MongoRuntimeImpl(options);
}
