import type {
  MongoDataTransformCheck,
  MongoDataTransformOperation,
  MongoFilterExpr,
  MongoIndexKey,
} from '@prisma-next/mongo-query-ast/control';
import {
  buildIndexOpId,
  CollModCommand,
  type CollModOptions,
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
  MongoExistsExpr,
  MongoFieldFilter,
  type MongoMigrationPlanOperation,
} from '@prisma-next/mongo-query-ast/control';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import type { CollModMeta } from './op-factory-call';

interface Buildable {
  build(): MongoQueryPlan;
}

function isBuildable(value: unknown): value is Buildable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'build' in value &&
    typeof (value as { build: unknown }).build === 'function'
  );
}

function resolveQuery(value: MongoQueryPlan | Buildable): MongoQueryPlan {
  return isBuildable(value) ? value.build() : value;
}

const MATCH_ALL_FILTER: MongoFilterExpr = MongoExistsExpr.exists('_id');

export function dataTransform(
  name: string,
  options: {
    check?: {
      source: () => MongoQueryPlan | Buildable;
      filter?: MongoFilterExpr;
      expect?: 'exists' | 'notExists';
      description?: string;
    };
    run: (() => MongoQueryPlan | Buildable) | MongoQueryPlan | Buildable;
  },
): MongoDataTransformOperation {
  let precheck: readonly MongoDataTransformCheck[] = [];
  let postcheck: readonly MongoDataTransformCheck[] = [];

  if (options.check) {
    const source = resolveQuery(options.check.source());
    const filter = options.check.filter ?? MATCH_ALL_FILTER;
    const description = options.check.description ?? `Check for data transform: ${name}`;
    const precheckExpect = options.check.expect ?? 'exists';
    const postcheckExpect: 'exists' | 'notExists' =
      precheckExpect === 'exists' ? 'notExists' : 'exists';

    precheck = [{ description, source, filter, expect: precheckExpect }];
    postcheck = [{ description, source, filter, expect: postcheckExpect }];
  }

  const run: MongoQueryPlan[] = [];
  if (typeof options.run === 'function') {
    run.push(resolveQuery(options.run()));
  } else {
    run.push(resolveQuery(options.run));
  }

  return {
    id: `data_transform.${name}`,
    label: `Data transform: ${name}`,
    operationClass: 'data',
    name,
    precheck,
    run,
    postcheck,
  };
}

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
          unique: options?.unique ?? undefined,
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

export function collMod(
  collection: string,
  options: CollModOptions,
  meta?: CollModMeta,
): MongoMigrationPlanOperation {
  const hasValidator = options.validator != null && Object.keys(options.validator).length > 0;

  return {
    id: meta?.id ?? `collection.${collection}.collMod`,
    label: meta?.label ?? `Modify collection ${collection}`,
    operationClass: meta?.operationClass ?? 'destructive',
    precheck:
      options.validator != null
        ? [
            {
              description: `collection ${collection} exists`,
              source: new ListCollectionsCommand(),
              filter: MongoFieldFilter.eq('name', collection),
              expect: 'exists' as const,
            },
          ]
        : [],
    execute: [
      {
        description: `modify ${collection}`,
        command: new CollModCommand(collection, options),
      },
    ],
    postcheck: hasValidator
      ? [
          {
            description: `validator applied on ${collection}`,
            source: new ListCollectionsCommand(),
            filter: MongoAndExpr.of([
              MongoFieldFilter.eq('name', collection),
              ...(options.validationLevel
                ? [MongoFieldFilter.eq('options.validationLevel', options.validationLevel)]
                : []),
              ...(options.validationAction
                ? [MongoFieldFilter.eq('options.validationAction', options.validationAction)]
                : []),
            ]),
            expect: 'exists' as const,
          },
        ]
      : [],
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
