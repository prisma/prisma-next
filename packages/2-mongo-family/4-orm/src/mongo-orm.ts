import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-core';
import type { MongoCollection } from './collection';
import { createMongoCollection } from './collection';
import type { MongoQueryExecutor } from './executor';

export interface MongoOrmOptions<TContract extends MongoContract> {
  readonly contract: TContract;
  readonly executor: MongoQueryExecutor;
}

export type MongoOrmClient<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
> = {
  readonly [K in keyof TContract['roots']]: TContract['roots'][K] extends string &
    keyof TContract['models']
    ? MongoCollection<TContract, TContract['roots'][K]>
    : never;
};

export function mongoOrm<TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>>(
  options: MongoOrmOptions<TContract>,
): MongoOrmClient<TContract> {
  const { contract, executor } = options;
  const client: Record<string, unknown> = {};

  for (const [rootName, modelName] of Object.entries(contract.roots)) {
    client[rootName] = createMongoCollection(
      contract,
      modelName as string & keyof TContract['models'],
      executor,
    );
  }

  return client as MongoOrmClient<TContract>;
}
