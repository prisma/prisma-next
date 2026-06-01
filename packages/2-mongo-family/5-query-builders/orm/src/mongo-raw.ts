import {
  defaultDomainNamespaceIdForMongo,
  domainModelsAtDefaultNamespace,
  type PlanMeta,
} from '@prisma-next/contract/types';
import type { MongoContract, MongoModelDefinition } from '@prisma-next/mongo-contract';
import { createRawMongoCollection, type RawMongoCollection } from './raw-collection';

export interface MongoRawClient<TContract extends MongoContract> {
  collection<K extends keyof TContract['roots'] & string>(rootName: K): RawMongoCollection;
}

export function mongoRaw<TContract extends MongoContract>(options: {
  contract: TContract;
}): MongoRawClient<TContract> {
  const { contract } = options;

  return {
    collection<K extends keyof TContract['roots'] & string>(rootName: K): RawMongoCollection {
      const modelName = contract.roots[rootName]?.model;
      const models = domainModelsAtDefaultNamespace(
        contract.domain,
        defaultDomainNamespaceIdForMongo(),
      );
      if (!modelName || !Object.hasOwn(models, modelName)) {
        throw new Error(`Unknown model "${modelName ?? ''}" for root "${rootName}"`);
      }
      const model = models[modelName] as MongoModelDefinition;
      const collectionName = model.storage.collection ?? modelName;

      const meta: PlanMeta = {
        target: 'mongo',
        storageHash: contract.storage.storageHash,
        lane: 'mongo-raw',
      };

      return createRawMongoCollection(collectionName, meta);
    },
  };
}
