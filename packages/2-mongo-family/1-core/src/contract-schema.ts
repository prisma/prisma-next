import { type } from 'arktype';

const MongoModelFieldSchema = type({
  '+': 'reject',
  codecId: 'string',
  nullable: 'boolean',
});

const MongoModelStorageSchema = type({
  '+': 'reject',
  'collection?': 'string',
});

const MongoDiscriminatorSchema = type({
  '+': 'reject',
  field: 'string',
});

const MongoVariantEntrySchema = type({
  '+': 'reject',
  value: 'string',
});

const MongoReferenceRelationOnSchema = type({
  '+': 'reject',
  localFields: 'string[]',
  targetFields: 'string[]',
});

const MongoReferenceRelationSchema = type({
  '+': 'reject',
  to: 'string',
  cardinality: "'1:1' | '1:N' | 'N:1'",
  strategy: "'reference'",
  on: MongoReferenceRelationOnSchema,
});

const MongoEmbedRelationSchema = type({
  '+': 'reject',
  to: 'string',
  cardinality: "'1:1' | '1:N'",
  strategy: "'embed'",
  field: 'string',
});

const MongoRelationSchema = MongoReferenceRelationSchema.or(MongoEmbedRelationSchema);

const MongoModelDefinitionSchema = type({
  '+': 'reject',
  fields: type('Record<string, unknown>').pipe((fields) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      const parsed = MongoModelFieldSchema(value);
      if (parsed instanceof type.errors) {
        throw new Error(`Invalid field "${key}": ${parsed.summary}`);
      }
      result[key] = parsed;
    }
    return result;
  }),
  storage: MongoModelStorageSchema,
  relations: type('Record<string, unknown>').pipe((relations) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(relations)) {
      const parsed = MongoRelationSchema(value);
      if (parsed instanceof type.errors) {
        throw new Error(`Invalid relation "${key}": ${parsed.summary}`);
      }
      result[key] = parsed;
    }
    return result;
  }),
  'discriminator?': MongoDiscriminatorSchema,
  'variants?': type('Record<string, unknown>').pipe((variants) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(variants)) {
      const parsed = MongoVariantEntrySchema(value);
      if (parsed instanceof type.errors) {
        throw new Error(`Invalid variant "${key}": ${parsed.summary}`);
      }
      result[key] = parsed;
    }
    return result;
  }),
  'base?': 'string',
});

const MongoStorageCollectionSchema = type({});

export const MongoContractSchema = type({
  '+': 'reject',
  targetFamily: "'mongo'",
  roots: 'Record<string, string>',
  storage: type({
    '+': 'reject',
    collections: type('Record<string, unknown>').pipe((collections) => {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(collections)) {
        const parsed = MongoStorageCollectionSchema(value);
        if (parsed instanceof type.errors) {
          throw new Error(`Invalid collection "${key}": ${parsed.summary}`);
        }
        result[key] = parsed;
      }
      return result;
    }),
  }),
  models: type('Record<string, unknown>').pipe((models) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(models)) {
      const parsed = MongoModelDefinitionSchema(value);
      if (parsed instanceof type.errors) {
        throw new Error(`Invalid model "${key}": ${parsed.summary}`);
      }
      result[key] = parsed;
    }
    return result;
  }),
});
