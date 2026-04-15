import type { MongoIndexKey } from '@prisma-next/mongo-query-ast/control';
import {
  buildIndexOpId,
  CollModCommand,
  CreateCollectionCommand,
  type CreateCollectionOptions,
  CreateIndexCommand,
  type CreateIndexOptions,
  DropCollectionCommand,
  DropIndexCommand,
  defaultMongoIndexName,
  keysToKeySpec,
  ListCollectionsCommand,
  ListIndexesCommand,
  MongoAndExpr,
  MongoFieldFilter,
  type MongoMigrationPlanOperation,
} from '@prisma-next/mongo-query-ast/control';

function formatKeys(keys: ReadonlyArray<MongoIndexKey>): string {
  return keys.map((k) => `${k.field}:${k.direction}`).join(', ');
}

function isTextIndex(keys: ReadonlyArray<MongoIndexKey>): boolean {
  return keys.some((k) => k.direction === 'text');
}

function keyFilter(keys: ReadonlyArray<MongoIndexKey>) {
  return isTextIndex(keys)
    ? MongoFieldFilter.eq('key._fts', 'text')
    : MongoFieldFilter.eq('key', keysToKeySpec(keys));
}

export function createIndex(
  collection: string,
  keys: ReadonlyArray<MongoIndexKey>,
  options?: CreateIndexOptions,
): MongoMigrationPlanOperation {
  const name = defaultMongoIndexName(keys);
  const filter = keyFilter(keys);
  const fullFilter = options?.unique
    ? MongoAndExpr.of([filter, MongoFieldFilter.eq('unique', true)])
    : filter;

  return {
    id: buildIndexOpId('create', collection, keys),
    label: `Create index on ${collection} (${formatKeys(keys)})`,
    operationClass: 'additive',
    precheck: [
      {
        description: `index does not already exist on ${collection}`,
        source: new ListIndexesCommand(collection),
        filter,
        expect: 'notExists',
      },
    ],
    execute: [
      {
        description: `create index on ${collection}`,
        command: new CreateIndexCommand(collection, keys, {
          ...options,
          unique: options?.unique || undefined,
          name,
        }),
      },
    ],
    postcheck: [
      {
        description: `index exists on ${collection}`,
        source: new ListIndexesCommand(collection),
        filter: fullFilter,
        expect: 'exists',
      },
    ],
  };
}

export function dropIndex(
  collection: string,
  keys: ReadonlyArray<MongoIndexKey>,
): MongoMigrationPlanOperation {
  const indexName = defaultMongoIndexName(keys);
  const filter = keyFilter(keys);

  return {
    id: buildIndexOpId('drop', collection, keys),
    label: `Drop index on ${collection} (${formatKeys(keys)})`,
    operationClass: 'destructive',
    precheck: [
      {
        description: `index exists on ${collection}`,
        source: new ListIndexesCommand(collection),
        filter,
        expect: 'exists',
      },
    ],
    execute: [
      {
        description: `drop index on ${collection}`,
        command: new DropIndexCommand(collection, indexName),
      },
    ],
    postcheck: [
      {
        description: `index no longer exists on ${collection}`,
        source: new ListIndexesCommand(collection),
        filter,
        expect: 'notExists',
      },
    ],
  };
}

export function createCollection(
  collection: string,
  options?: CreateCollectionOptions,
): MongoMigrationPlanOperation {
  return {
    id: `collection.${collection}.create`,
    label: `Create collection ${collection}`,
    operationClass: 'additive',
    precheck: [
      {
        description: `collection ${collection} does not exist`,
        source: new ListCollectionsCommand(),
        filter: MongoFieldFilter.eq('name', collection),
        expect: 'notExists',
      },
    ],
    execute: [
      {
        description: `create collection ${collection}`,
        command: new CreateCollectionCommand(collection, options),
      },
    ],
    postcheck: [],
  };
}

export function dropCollection(collection: string): MongoMigrationPlanOperation {
  return {
    id: `collection.${collection}.drop`,
    label: `Drop collection ${collection}`,
    operationClass: 'destructive',
    precheck: [],
    execute: [
      {
        description: `drop collection ${collection}`,
        command: new DropCollectionCommand(collection),
      },
    ],
    postcheck: [],
  };
}

export function setValidation(
  collection: string,
  schema: Record<string, unknown>,
  options?: { validationLevel?: 'strict' | 'moderate'; validationAction?: 'error' | 'warn' },
): MongoMigrationPlanOperation {
  return {
    id: `collection.${collection}.setValidation`,
    label: `Set validation on ${collection}`,
    operationClass: 'destructive',
    precheck: [],
    execute: [
      {
        description: `set validation on ${collection}`,
        command: new CollModCommand(collection, {
          validator: { $jsonSchema: schema },
          validationLevel: options?.validationLevel,
          validationAction: options?.validationAction,
        }),
      },
    ],
    postcheck: [],
  };
}

export function validatedCollection(
  name: string,
  schema: Record<string, unknown>,
  indexes: ReadonlyArray<{ keys: MongoIndexKey[]; unique?: boolean }>,
): MongoMigrationPlanOperation[] {
  return [
    createCollection(name, {
      validator: { $jsonSchema: schema },
      validationLevel: 'strict',
      validationAction: 'error',
    }),
    ...indexes.map((idx) => createIndex(name, idx.keys, { unique: idx.unique })),
  ];
}
