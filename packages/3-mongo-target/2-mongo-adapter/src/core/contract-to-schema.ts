import type {
  MongoStorageCollection,
  MongoStorageCollectionOptions,
  MongoStorageIndex,
  MongoStorageValidator,
} from '@prisma-next/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptionsNode,
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

function convertOptions(o: MongoStorageCollectionOptions): MongoSchemaCollectionOptionsNode {
  return new MongoSchemaCollectionOptionsNode({
    capped: o.capped,
    timeseries: o.timeseries,
    collation: o.collation,
    changeStreamPreAndPostImages: o.changeStreamPreAndPostImages,
    clusteredIndex: o.clusteredIndex,
  });
}

function convertCollection(name: string, def: MongoStorageCollection): MongoSchemaCollection {
  return new MongoSchemaCollection({
    name,
    indexes: (def.indexes ?? []).map(convertIndex),
    validator: def.validator ? convertValidator(def.validator) : undefined,
    options: def.options ? convertOptions(def.options) : undefined,
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
