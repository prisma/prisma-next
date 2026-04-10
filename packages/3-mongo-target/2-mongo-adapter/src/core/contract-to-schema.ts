import type {
  MongoContract,
  MongoIndex,
  MongoStorageCollection,
} from '@prisma-next/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaIndex,
  type MongoSchemaIR,
} from '@prisma-next/mongo-schema-ir';

function convertIndex(index: MongoIndex): MongoSchemaIndex {
  const keys = Object.entries(index.fields).map(([field, direction]) => ({
    field,
    direction,
  }));
  return new MongoSchemaIndex({
    keys,
    unique: index.options?.unique,
    sparse: index.options?.sparse,
    expireAfterSeconds: index.options?.expireAfterSeconds,
    partialFilterExpression: index.options?.partialFilterExpression as
      | Record<string, unknown>
      | undefined,
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
