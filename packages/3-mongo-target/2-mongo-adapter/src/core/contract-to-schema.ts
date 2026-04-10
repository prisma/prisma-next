import type {
  MongoContract,
  MongoStorageCollection,
  MongoStorageCollectionOptions,
  MongoStorageIndex,
  MongoStorageValidator,
} from '@prisma-next/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  type MongoSchemaIR,
  MongoSchemaValidator,
} from '@prisma-next/mongo-schema-ir';

function convertIndex(index: MongoStorageIndex): MongoSchemaIndex {
  return new MongoSchemaIndex({
    keys: index.keys,
    unique: index.unique,
    sparse: index.sparse,
    expireAfterSeconds: index.expireAfterSeconds,
    partialFilterExpression: index.partialFilterExpression,
    wildcardProjection: index.wildcardProjection,
    collation: index.collation,
    weights: index.weights,
    default_language: index.default_language,
    language_override: index.language_override,
  });
}

function convertValidator(v: MongoStorageValidator): MongoSchemaValidator {
  return new MongoSchemaValidator({
    jsonSchema: v.jsonSchema,
    validationLevel: v.validationLevel,
    validationAction: v.validationAction,
  });
}

function convertOptions(o: MongoStorageCollectionOptions): MongoSchemaCollectionOptions {
  return new MongoSchemaCollectionOptions(o);
}

function convertCollection(name: string, def: MongoStorageCollection): MongoSchemaCollection {
  const indexes = (def.indexes ?? []).map(convertIndex);
  return new MongoSchemaCollection({
    name,
    indexes,
    ...(def.validator != null && { validator: convertValidator(def.validator) }),
    ...(def.options != null && { options: convertOptions(def.options) }),
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
