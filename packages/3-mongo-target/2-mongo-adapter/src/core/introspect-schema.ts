import type { MongoIndexKey, MongoIndexKeyDirection } from '@prisma-next/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  type MongoSchemaIR,
  MongoSchemaValidator,
} from '@prisma-next/mongo-schema-ir';
import type { Db, Document } from 'mongodb';

const PRISMA_MIGRATIONS_COLLECTION = '_prisma_migrations';

function parseIndexKeys(keySpec: Record<string, unknown>): MongoIndexKey[] {
  const keys: MongoIndexKey[] = [];
  for (const [field, direction] of Object.entries(keySpec)) {
    keys.push({ field, direction: direction as MongoIndexKeyDirection });
  }
  return keys;
}

function isDefaultIdIndex(doc: Document): boolean {
  const key = doc['key'] as Record<string, unknown> | undefined;
  if (!key) return false;
  const entries = Object.entries(key);
  return entries.length === 1 && entries[0]![0] === '_id' && entries[0]![1] === 1;
}

function parseIndex(doc: Document): MongoSchemaIndex {
  const keySpec = doc['key'] as Record<string, unknown>;
  return new MongoSchemaIndex({
    keys: parseIndexKeys(keySpec),
    unique: (doc['unique'] as boolean | undefined) ?? undefined,
    sparse: (doc['sparse'] as boolean | undefined) ?? undefined,
    expireAfterSeconds: (doc['expireAfterSeconds'] as number | undefined) ?? undefined,
    partialFilterExpression:
      (doc['partialFilterExpression'] as Record<string, unknown> | undefined) ?? undefined,
    wildcardProjection:
      (doc['wildcardProjection'] as Record<string, 0 | 1> | undefined) ?? undefined,
    collation: (doc['collation'] as Record<string, unknown> | undefined) ?? undefined,
    weights: (doc['weights'] as Record<string, number> | undefined) ?? undefined,
    default_language: (doc['default_language'] as string | undefined) ?? undefined,
    language_override: (doc['language_override'] as string | undefined) ?? undefined,
  });
}

function parseValidator(options: Document): MongoSchemaValidator | undefined {
  const validator = options['validator'] as Record<string, unknown> | undefined;
  if (!validator) return undefined;

  const jsonSchema = validator['$jsonSchema'] as Record<string, unknown> | undefined;
  if (!jsonSchema) return undefined;

  return new MongoSchemaValidator({
    jsonSchema,
    validationLevel: (options['validationLevel'] as 'strict' | 'moderate') ?? 'strict',
    validationAction: (options['validationAction'] as 'error' | 'warn') ?? 'error',
  });
}

function parseCollectionOptions(info: Document): MongoSchemaCollectionOptions | undefined {
  const options = info['options'] as Record<string, unknown> | undefined;
  if (!options) return undefined;

  const capped = options['capped'] as boolean | undefined;
  const size = options['size'] as number | undefined;
  const max = options['max'] as number | undefined;
  const timeseries = options['timeseries'] as
    | { timeField: string; metaField?: string; granularity?: 'seconds' | 'minutes' | 'hours' }
    | undefined;
  const collation = options['collation'] as Record<string, unknown> | undefined;
  const changeStreamPreAndPostImages = options['changeStreamPreAndPostImages'] as
    | { enabled: boolean }
    | undefined;
  const clusteredIndex = options['clusteredIndex'] as { name?: string } | undefined;

  const hasMeaningfulOptions =
    capped || timeseries || collation || changeStreamPreAndPostImages || clusteredIndex;
  if (!hasMeaningfulOptions) return undefined;

  return new MongoSchemaCollectionOptions({
    ...(capped ? { capped: { size: size ?? 0, ...(max != null ? { max } : {}) } } : {}),
    ...(timeseries ? { timeseries } : {}),
    ...(collation ? { collation } : {}),
    ...(changeStreamPreAndPostImages ? { changeStreamPreAndPostImages } : {}),
    ...(clusteredIndex ? { clusteredIndex } : {}),
  });
}

export async function introspectSchema(db: Db): Promise<MongoSchemaIR> {
  const collectionInfos = await db.listCollections().toArray();

  const collections: Record<string, MongoSchemaCollection> = {};

  for (const info of collectionInfos) {
    const name = info['name'] as string;
    const type = info['type'] as string | undefined;

    if (name === PRISMA_MIGRATIONS_COLLECTION) continue;
    if (name.startsWith('system.')) continue;
    if (type === 'view') continue;

    const indexDocs = await db.collection(name).listIndexes().toArray();
    const indexes = indexDocs.filter((doc) => !isDefaultIdIndex(doc)).map(parseIndex);

    const validator = parseValidator(info['options'] ?? {});
    const options = parseCollectionOptions(info);

    collections[name] = new MongoSchemaCollection({
      name,
      indexes,
      ...(validator ? { validator } : {}),
      ...(options ? { options } : {}),
    });
  }

  return { collections };
}
