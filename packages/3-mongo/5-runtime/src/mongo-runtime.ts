import type { MongoAdapter, MongoLoweringContext } from '@prisma-next/mongo-adapter';
import type { MongoQueryPlan } from '@prisma-next/mongo-core';
import type { MongoDriver } from '@prisma-next/mongo-driver';
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

export function createMongoRuntime(options: MongoRuntimeOptions): MongoRuntime {
  const { adapter, driver, loweringContext } = options;

  return {
    execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
      const executionPlan = adapter.lower(plan, loweringContext);
      const iterable = driver.execute<Row>(executionPlan.wireCommand);

      async function* toGenerator(): AsyncGenerator<Row, void, unknown> {
        yield* iterable;
      }

      return new AsyncIterableResult(toGenerator());
    },

    async close(): Promise<void> {
      await driver.close();
    },
  };
}
