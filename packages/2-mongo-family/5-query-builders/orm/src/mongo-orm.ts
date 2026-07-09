import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
  RootModelName,
} from '@prisma-next/mongo-contract';
import { blindCast } from '@prisma-next/utils/casts';
import type { MongoCollection } from './collection';
import { createMongoCollection } from './collection';
import type { MongoQueryExecutor } from './executor';

export type AnyMongoCollectionClass = new (...args: never[]) => object;

export interface MongoOrmOptions<
  TContract extends MongoContract,
  Collections extends Partial<Record<string, AnyMongoCollectionClass>> = Record<never, never>,
> {
  readonly contract: TContract;
  readonly executor: MongoQueryExecutor;
  /**
   * Custom `Collection` subclasses keyed by model name (not root/collection name),
   * mirroring the SQL ORM's `orm({ collections })`. Roots whose model has no entry
   * get the base collection.
   */
  readonly collections?: Collections;
}

type CustomCollectionForModel<
  Collections extends Partial<Record<string, AnyMongoCollectionClass>>,
  ModelName extends string,
> = ModelName extends keyof Collections
  ? Collections[ModelName] extends AnyMongoCollectionClass
    ? InstanceType<Collections[ModelName]>
    : never
  : never;

type RootCollection<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  Collections extends Partial<Record<string, AnyMongoCollectionClass>>,
  RootName extends keyof TContract['roots'] & string,
> = [CustomCollectionForModel<Collections, RootModelName<TContract, RootName>>] extends [never]
  ? MongoCollection<TContract, RootModelName<TContract, RootName>>
  : CustomCollectionForModel<Collections, RootModelName<TContract, RootName>>;

export type MongoOrmClient<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  Collections extends Partial<Record<string, AnyMongoCollectionClass>> = Record<never, never>,
> = {
  readonly [K in keyof TContract['roots'] & string]: RootCollection<TContract, Collections, K>;
};

export function mongoOrm<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  Collections extends Partial<Record<string, AnyMongoCollectionClass>> = Record<never, never>,
>(options: MongoOrmOptions<TContract, Collections>): MongoOrmClient<TContract, Collections> {
  const { contract, executor, collections } = options;
  const client: Record<string, unknown> = {};

  for (const [rootName, rootRef] of Object.entries(contract.roots)) {
    const modelName = blindCast<
      RootModelName<TContract, typeof rootName & keyof TContract['roots'] & string>,
      'roots entries are CrossReferences; rootRef.model is a valid RootModelName for this contract'
    >(rootRef.model);
    const CustomCtor = collections?.[rootRef.model];
    client[rootName] = CustomCtor
      ? new (blindCast<
          new (
            contract: TContract,
            modelName: string,
            executor: MongoQueryExecutor,
          ) => object,
          'a registered collection class is a Collection subclass constructor'
        >(CustomCtor))(contract, modelName, executor)
      : createMongoCollection(contract, modelName, executor);
  }

  return client as MongoOrmClient<TContract, Collections>;
}
