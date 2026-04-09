import { type } from 'arktype';
import type { MongoJsonObject, MongoJsonPrimitive, MongoJsonValue } from './contract-types';

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

const MongoJsonPrimitiveSchema = type
  .declare<MongoJsonPrimitive>()
  .type('string | number | boolean | null');

function isMongoJsonRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isMongoJsonObject(value: unknown): value is MongoJsonObject {
  return isMongoJsonRecord(value) && Object.values(value).every((entry) => isMongoJsonValue(entry));
}

function isMongoJsonValue(value: unknown): value is MongoJsonValue {
  if (MongoJsonPrimitiveSchema.allows(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isMongoJsonValue(entry));
  }
  return isMongoJsonObject(value);
}

const MongoJsonValueSchema = type('unknown').narrow((value, ctx) =>
  isMongoJsonValue(value) ? true : ctx.mustBe('a JSON-serializable MongoJsonValue'),
);

const MongoJsonObjectSchema = type({ '[string]': 'unknown' }).narrow((value, ctx) =>
  isMongoJsonRecord(value) &&
  Object.values(value).every((entry) => MongoJsonValueSchema.allows(entry))
    ? true
    : ctx.mustBe('a JSON object with MongoJsonValue entries'),
);

const NumberRecordSchema = type({ '[string]': 'number' });

const IndexFieldsSchema = type({
  '+': 'reject',
  '[string]': '1 | -1 | "text" | "2dsphere" | "2d" | "hashed"',
}).narrow((fields, ctx) =>
  Object.keys(fields).length > 0 ? true : ctx.mustBe('an index field map with at least one entry'),
);

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
  'partialFilterExpression?': MongoJsonObjectSchema,
  'sparse?': 'boolean',
  'expireAfterSeconds?': 'number',
  'weights?': NumberRecordSchema,
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
  'storageEngine?': MongoJsonObjectSchema,
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
}).narrow((key, ctx) =>
  Object.keys(key).length > 0
    ? true
    : ctx.mustBe('a clustered index key map with at least one entry'),
);

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
  'storageEngine?': MongoJsonObjectSchema,
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
