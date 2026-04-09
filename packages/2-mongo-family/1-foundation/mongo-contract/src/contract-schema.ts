import { type } from 'arktype';

const ScalarFieldTypeSchema = type({
  '+': 'reject',
  kind: "'scalar'",
  codecId: 'string',
  'typeParams?': 'Record<string, unknown>',
});

const ValueObjectFieldTypeSchema = type({
  '+': 'reject',
  kind: "'valueObject'",
  name: 'string',
});

const UnionFieldTypeSchema = type({
  '+': 'reject',
  kind: "'union'",
  members: ScalarFieldTypeSchema.or(ValueObjectFieldTypeSchema).array(),
});

const FieldTypeSchema = ScalarFieldTypeSchema.or(ValueObjectFieldTypeSchema).or(
  UnionFieldTypeSchema,
);

const RawFieldSchema = type({
  '+': 'reject',
  type: FieldTypeSchema,
  'nullable?': 'boolean',
  'many?': 'boolean',
  'dict?': 'boolean',
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

const IndexFieldsSchema = type({
  '+': 'reject',
  '[string]': '1 | -1 | "text" | "2dsphere" | "2d" | "hashed"',
});

const CollationSchema = type({
  '+': 'reject',
  locale: 'string',
  'caseLevel?': 'boolean',
  'caseFirst?': '"off" | "upper" | "lower"',
  'strength?': '1 | 2 | 3 | 4 | 5',
  'numericOrdering?': 'boolean',
  'alternate?': '"non-ignorable" | "shifted"',
  'maxVariable?': '"punct" | "space"',
  'backwards?': 'boolean',
  'normalization?': 'boolean',
});

const WildcardProjectionSchema = type({
  '+': 'reject',
  '[string]': '0 | 1',
});

const IndexOptionsSchema = type({
  '+': 'reject',
  'unique?': 'boolean',
  'name?': 'string',
  'partialFilterExpression?': 'Record<string, unknown>',
  'sparse?': 'boolean',
  'expireAfterSeconds?': 'number',
  'weights?': 'Record<string, number>',
  'default_language?': 'string',
  'language_override?': 'string',
  'textIndexVersion?': 'number',
  '2dsphereIndexVersion?': 'number',
  'bits?': 'number',
  'min?': 'number',
  'max?': 'number',
  'bucketSize?': 'number',
  'hidden?': 'boolean',
  'collation?': CollationSchema,
  'wildcardProjection?': WildcardProjectionSchema,
});

const IndexSchema = type({
  '+': 'reject',
  fields: IndexFieldsSchema,
  'options?': IndexOptionsSchema,
});

const IndexOptionDefaultsSchema = type({
  '+': 'reject',
  'storageEngine?': 'Record<string, unknown>',
});

const TimeSeriesCollectionOptionsSchema = type({
  '+': 'reject',
  timeField: 'string',
  'metaField?': 'string',
  'granularity?': '"seconds" | "minutes" | "hours"',
  'bucketMaxSpanSeconds?': 'number',
  'bucketRoundingSeconds?': 'number',
});

const ClusteredCollectionKeySchema = type({
  '+': 'reject',
  '[string]': '1',
});

const ClusteredCollectionOptionsSchema = type({
  '+': 'reject',
  'name?': 'string',
  key: ClusteredCollectionKeySchema,
  unique: 'boolean',
});

const ChangeStreamPreAndPostImagesSchema = type({
  '+': 'reject',
  enabled: 'boolean',
});

const CollectionOptionsSchema = type({
  '+': 'reject',
  'capped?': 'boolean',
  'size?': 'number',
  'max?': 'number',
  'storageEngine?': 'Record<string, unknown>',
  'indexOptionDefaults?': IndexOptionDefaultsSchema,
  'collation?': CollationSchema,
  'timeseries?': TimeSeriesCollectionOptionsSchema,
  'clusteredIndex?': ClusteredCollectionOptionsSchema,
  'expireAfterSeconds?': 'number',
  'changeStreamPreAndPostImages?': ChangeStreamPreAndPostImagesSchema,
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

const StorageCollectionSchema = type({
  '+': 'reject',
  'indexes?': IndexSchema.array(),
  'options?': CollectionOptionsSchema,
});

export const MongoContractSchema = type({
  '+': 'reject',
  targetFamily: "'mongo'",
  'schemaVersion?': 'string',
  'target?': 'string',
  'storageHash?': 'string',
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
    'storageHash?': 'string',
  }),
  models: type({ '[string]': ModelDefinitionSchema }),
  'valueObjects?': type({
    '[string]': type({ '+': 'reject', fields: type({ '[string]': FieldSchema }) }),
  }),
});
