import { type } from 'arktype';

const RawFieldSchema = type({
  '+': 'reject',
  codecId: 'string',
  'nullable?': 'boolean',
});

const FieldSchema = RawFieldSchema.pipe((field) => ({
  ...field,
  nullable: field.nullable ?? false,
}));

const RelationOnSchema = type({
  '+': 'reject',
  localFields: 'string[]',
  targetFields: 'string[]',
});

const RelationSchema = type({
  '+': 'reject',
  to: 'string',
  cardinality: "'1:1' | '1:N' | 'N:1'",
  'on?': RelationOnSchema,
});

const StorageRelationEntrySchema = type({
  '+': 'reject',
  field: 'string',
});

const ModelStorageSchema = type({
  '+': 'reject',
  'collection?': 'string',
  'relations?': type('Record<string, unknown>').pipe((relations) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(relations)) {
      const parsed = StorageRelationEntrySchema(value);
      if (parsed instanceof type.errors) {
        throw new Error(`Invalid storage relation "${key}": ${parsed.summary}`);
      }
      result[key] = parsed;
    }
    return result;
  }),
});

const DiscriminatorSchema = type({
  '+': 'reject',
  field: 'string',
});

const VariantEntrySchema = type({
  '+': 'reject',
  value: 'string',
});

const ModelDefinitionSchema = type({
  '+': 'reject',
  fields: type('Record<string, unknown>').pipe((fields) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      const parsed = FieldSchema(value);
      if (parsed instanceof type.errors) {
        throw new Error(`Invalid field "${key}": ${parsed.summary}`);
      }
      result[key] = parsed;
    }
    return result;
  }),
  storage: ModelStorageSchema,
  relations: type('Record<string, unknown>').pipe((relations) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(relations)) {
      const parsed = RelationSchema(value);
      if (parsed instanceof type.errors) {
        throw new Error(`Invalid relation "${key}": ${parsed.summary}`);
      }
      result[key] = parsed;
    }
    return result;
  }),
  'discriminator?': DiscriminatorSchema,
  'variants?': type('Record<string, unknown>').pipe((variants) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(variants)) {
      const parsed = VariantEntrySchema(value);
      if (parsed instanceof type.errors) {
        throw new Error(`Invalid variant "${key}": ${parsed.summary}`);
      }
      result[key] = parsed;
    }
    return result;
  }),
  'base?': 'string',
  'owner?': 'string',
});

const StorageCollectionSchema = type({ '+': 'reject' });

export const MongoContractSchema = type({
  '+': 'reject',
  targetFamily: "'mongo'",
  'schemaVersion?': 'string',
  'target?': 'string',
  'storageHash?': 'string',
  'executionHash?': 'string',
  'profileHash?': 'string',
  roots: 'Record<string, string>',
  'relations?': 'Record<string, unknown>',
  'capabilities?': 'Record<string, unknown>',
  'extensionPacks?': 'Record<string, unknown>',
  'meta?': 'Record<string, unknown>',
  '_generated?': 'Record<string, unknown>',
  storage: type({
    '+': 'reject',
    collections: type('Record<string, unknown>').pipe((collections) => {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(collections)) {
        const parsed = StorageCollectionSchema(value);
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
      const parsed = ModelDefinitionSchema(value);
      if (parsed instanceof type.errors) {
        throw new Error(`Invalid model "${key}": ${parsed.summary}`);
      }
      result[key] = parsed;
    }
    return result;
  }),
});
