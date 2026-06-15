import type {
  MongoCollection,
  MongoCollectionOptions,
  MongoContract,
  MongoIndex,
  MongoValidator,
} from '@prisma-next/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@prisma-next/mongo-schema-ir';

function convertIndex(index: MongoIndex): MongoSchemaIndex {
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

function convertValidator(v: MongoValidator): MongoSchemaValidator {
  return new MongoSchemaValidator({
    jsonSchema: v.jsonSchema,
    validationLevel: v.validationLevel,
    validationAction: v.validationAction,
  });
}

function convertOptions(o: MongoCollectionOptions): MongoSchemaCollectionOptions {
  return new MongoSchemaCollectionOptions({
    ...(o.capped !== undefined && { capped: o.capped }),
    ...(o.timeseries !== undefined && {
      timeseries: {
        timeField: o.timeseries.timeField,
        ...(o.timeseries.metaField !== undefined && { metaField: o.timeseries.metaField }),
        ...(o.timeseries.granularity !== undefined && { granularity: o.timeseries.granularity }),
      },
    }),
    ...(o.collation !== undefined && {
      collation: {
        locale: o.collation.locale,
        ...(o.collation.caseLevel !== undefined && { caseLevel: o.collation.caseLevel }),
        ...(o.collation.caseFirst !== undefined && { caseFirst: o.collation.caseFirst }),
        ...(o.collation.strength !== undefined && { strength: o.collation.strength }),
        ...(o.collation.numericOrdering !== undefined && {
          numericOrdering: o.collation.numericOrdering,
        }),
        ...(o.collation.alternate !== undefined && { alternate: o.collation.alternate }),
        ...(o.collation.maxVariable !== undefined && { maxVariable: o.collation.maxVariable }),
        ...(o.collation.backwards !== undefined && { backwards: o.collation.backwards }),
        ...(o.collation.normalization !== undefined && {
          normalization: o.collation.normalization,
        }),
      },
    }),
    ...(o.changeStreamPreAndPostImages !== undefined && {
      changeStreamPreAndPostImages: { enabled: o.changeStreamPreAndPostImages.enabled },
    }),
    ...(o.clusteredIndex !== undefined && { clusteredIndex: o.clusteredIndex }),
  });
}

function convertCollection(name: string, def: MongoCollection): MongoSchemaCollection {
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
    return new MongoSchemaIR([]);
  }

  const collections: MongoSchemaCollection[] = [];
  for (const ns of Object.values(contract.storage.namespaces)) {
    for (const [name, def] of Object.entries(ns.entries.collection ?? {})) {
      collections.push(convertCollection(name, def));
    }
  }

  return new MongoSchemaIR(collections);
}
