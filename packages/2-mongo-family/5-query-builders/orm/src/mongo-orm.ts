import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
  RootModelName,
} from '@prisma-next/mongo-contract';
import { blindCast } from '@prisma-next/utils/casts';
import type { MongoCollection } from './collection';
import { Collection, createMongoCollection, MONGO_ORM_COLLECTION_BRAND } from './collection';
import type { MongoQueryExecutor } from './executor';

/**
 * A `Collection` subclass constructor. The brand restricts registration to classes
 * that actually extend `Collection`; the `never[]` parameters accept any concrete
 * subclass constructor (constructor parameters are contravariant).
 */
export type AnyMongoCollectionClass = new (
  ...args: never[]
) => {
  readonly [MONGO_ORM_COLLECTION_BRAND]: true;
};

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

function instantiateCustomCollection(
  CustomCtor: AnyMongoCollectionClass,
  contract: MongoContract,
  modelName: string,
  executor: MongoQueryExecutor,
): object {
  const Ctor = blindCast<
    new (
      contract: MongoContract,
      modelName: string,
      executor: MongoQueryExecutor,
    ) => object,
    'registered classes extend Collection (brand-checked statically, instanceof-checked below), so they take the base constructor arguments'
  >(CustomCtor);
  const instance = new Ctor(contract, modelName, executor);
  if (!(instance instanceof Collection)) {
    throw new Error(
      `collections["${modelName}"] must extend the Collection class exported by @prisma-next/mongo-orm`,
    );
  }
  return instance;
}

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
      ? instantiateCustomCollection(CustomCtor, contract, modelName, executor)
      : createMongoCollection(contract, modelName, executor);
  }

  return blindCast<
    MongoOrmClient<TContract, Collections>,
    'client is populated with one collection per contract root, matching the mapped type'
  >(client);
}
