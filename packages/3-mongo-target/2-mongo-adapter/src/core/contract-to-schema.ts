import type {
  MongoContract,
  MongoStorageCollection,
  MongoStorageIndex,
} from '@prisma-next/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaIndex,
  type MongoSchemaIR,
} from '@prisma-next/mongo-schema-ir';

function convertIndex(index: MongoStorageIndex): MongoSchemaIndex {
  return new MongoSchemaIndex({
    keys: index.keys,
    unique: index.unique,
    sparse: index.sparse,
    expireAfterSeconds: index.expireAfterSeconds,
    partialFilterExpression: index.partialFilterExpression,
  });
}

function convertCollection(name: string, def: MongoStorageCollection): MongoSchemaCollection {
  return new MongoSchemaCollection({
    name,
    indexes: (def.indexes ?? []).map(convertIndex),
  });
}

export function contractToMongoSchemaIR(contract: MongoContract | null): MongoSchemaIR {
  if (!contract) {
    return { collections: {} };
  }

  const collections: Record<string, MongoSchemaCollection> = {};

  for (const [collectionName, collectionDef] of Object.entries(contract.storage.collections)) {
    collections[collectionName] = convertCollection(collectionName, collectionDef);
  }

  return { collections };
}
