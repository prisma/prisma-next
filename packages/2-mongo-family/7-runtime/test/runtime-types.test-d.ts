import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import { mongoPipeline } from '@prisma-next/mongo-pipeline-builder';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';
import { expectTypeOf } from 'vitest';
import type { MongoRuntime } from '../src/mongo-runtime';

type TestContract = MongoContract & {
  readonly models: {
    readonly Order: {
      readonly fields: {
        readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };
        readonly status: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
        readonly amount: { readonly codecId: 'mongo/double@1'; readonly nullable: false };
      };
      readonly relations: Record<string, never>;
      readonly storage: { readonly collection: 'orders' };
    };
  };
  readonly roots: { readonly orders: 'Order' };
};

type TestCodecTypes = {
  readonly 'mongo/objectId@1': { readonly output: string };
  readonly 'mongo/string@1': { readonly output: string };
  readonly 'mongo/double@1': { readonly output: number };
};

type TContract = MongoContractWithTypeMaps<TestContract, MongoTypeMaps<TestCodecTypes>>;

type OrderRow = { _id: string; status: string; amount: number };

describe('runtime type safety', () => {
  it('execute() returns AsyncIterableResult<Row> matching build() row type', () => {
    const contractJson = {} as unknown;
    const plan = mongoPipeline<TContract>({ contractJson }).from('orders').build();
    const runtime = {} as MongoRuntime;
    const result = runtime.execute(plan);

    expectTypeOf(result).toEqualTypeOf<AsyncIterableResult<OrderRow>>();
  });

  it('execute() result awaits to Row[]', () => {
    const contractJson = {} as unknown;
    const plan = mongoPipeline<TContract>({ contractJson }).from('orders').build();
    const runtime = {} as MongoRuntime;

    expectTypeOf(runtime.execute(plan).toArray()).resolves.toEqualTypeOf<OrderRow[]>();
  });

  it('execute() infers Row from MongoQueryPlan generic parameter', () => {
    const runtime = {} as MongoRuntime;
    const plan = {} as MongoQueryPlan<OrderRow>;
    const result = runtime.execute(plan);

    expectTypeOf(result).toEqualTypeOf<AsyncIterableResult<OrderRow>>();
  });
});
