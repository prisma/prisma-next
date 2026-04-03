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
  'relations?': type({ '[string]': StorageRelationEntrySchema }),
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
  fields: type({ '[string]': FieldSchema }),
  storage: ModelStorageSchema,
  'relations?': type({ '[string]': RelationSchema }),
  'discriminator?': DiscriminatorSchema,
  'variants?': type({ '[string]': VariantEntrySchema }),
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
  'capabilities?': 'Record<string, unknown>',
  'extensionPacks?': 'Record<string, unknown>',
  'meta?': 'Record<string, unknown>',
  'sources?': 'Record<string, unknown>',
  '_generated?': 'Record<string, unknown>',
  storage: type({
    '+': 'reject',
    collections: type({ '[string]': StorageCollectionSchema }),
  }),
  models: type({ '[string]': ModelDefinitionSchema }),
});
