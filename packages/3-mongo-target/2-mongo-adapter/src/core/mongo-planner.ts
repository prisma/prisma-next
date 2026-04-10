import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  MigrationOperationPolicy,
  MigrationPlanner,
  MigrationPlannerConflict,
  MigrationPlannerResult,
} from '@prisma-next/framework-components/control';
import type { MongoContract, MongoIndexKey } from '@prisma-next/mongo-contract';
import {
  buildIndexOpId,
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
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
import {
  canonicalize,
  deepEqual,
  type MongoSchemaCollection,
  type MongoSchemaCollectionOptionsNode,
  type MongoSchemaIndex,
  type MongoSchemaIR,
  type MongoSchemaValidator,
} from '@prisma-next/mongo-schema-ir';
import { contractToMongoSchemaIR } from './contract-to-schema';

function buildIndexLookupKey(index: MongoSchemaIndex): string {
  const keys = index.keys.map((k) => `${k.field}:${k.direction}`).join(',');
  const opts = [
    index.unique ? 'unique' : '',
    index.sparse ? 'sparse' : '',
    index.expireAfterSeconds != null ? `ttl:${index.expireAfterSeconds}` : '',
    index.partialFilterExpression ? `pfe:${canonicalize(index.partialFilterExpression)}` : '',
    index.wildcardProjection ? `wp:${canonicalize(index.wildcardProjection)}` : '',
    index.collation ? `col:${canonicalize(index.collation)}` : '',
    index.weights ? `wt:${canonicalize(index.weights)}` : '',
    index.default_language ? `dl:${index.default_language}` : '',
    index.language_override ? `lo:${index.language_override}` : '',
  ]
    .filter(Boolean)
    .join(';');
  return opts ? `${keys}|${opts}` : keys;
}

function formatKeys(keys: ReadonlyArray<MongoIndexKey>): string {
  return keys.map((k) => `${k.field}:${k.direction}`).join(', ');
}

function isTextIndex(keys: ReadonlyArray<MongoIndexKey>): boolean {
  return keys.some((k) => k.direction === 'text');
}

function planCreateIndex(collection: string, index: MongoSchemaIndex): MongoMigrationPlanOperation {
  const { keys } = index;
  const name = defaultMongoIndexName(keys);

  const textIndex = isTextIndex(keys);
  const keyFilter = textIndex
    ? MongoFieldFilter.eq('key._fts', 'text')
    : MongoFieldFilter.eq('key', keysToKeySpec(keys));
  const fullFilter = index.unique
    ? MongoAndExpr.of([keyFilter, MongoFieldFilter.eq('unique', true)])
    : keyFilter;

  return {
    id: buildIndexOpId('create', collection, keys),
    label: `Create index on ${collection} (${formatKeys(keys)})`,
    operationClass: 'additive',
    precheck: [
      {
        description: `index does not already exist on ${collection}`,
        source: new ListIndexesCommand(collection),
        filter: keyFilter,
        expect: 'notExists',
      },
    ],
    execute: [
      {
        description: `create index on ${collection}`,
        command: new CreateIndexCommand(collection, keys, {
          unique: index.unique || undefined,
          sparse: index.sparse,
          expireAfterSeconds: index.expireAfterSeconds,
          partialFilterExpression: index.partialFilterExpression,
          wildcardProjection: index.wildcardProjection,
          collation: index.collation,
          weights: index.weights,
          default_language: index.default_language,
          language_override: index.language_override,
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

function planDropIndex(collection: string, index: MongoSchemaIndex): MongoMigrationPlanOperation {
  const { keys } = index;
  const indexName = defaultMongoIndexName(keys);
  const textIndex = isTextIndex(keys);
  const keyFilter = textIndex
    ? MongoFieldFilter.eq('key._fts', 'text')
    : MongoFieldFilter.eq('key', keysToKeySpec(keys));

  return {
    id: buildIndexOpId('drop', collection, keys),
    label: `Drop index on ${collection} (${formatKeys(keys)})`,
    operationClass: 'destructive',
    precheck: [
      {
        description: `index exists on ${collection}`,
        source: new ListIndexesCommand(collection),
        filter: keyFilter,
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
        filter: keyFilter,
        expect: 'notExists',
      },
    ],
  };
}

function validatorsEqual(
  a: MongoSchemaValidator | undefined,
  b: MongoSchemaValidator | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.validationLevel === b.validationLevel &&
    a.validationAction === b.validationAction &&
    deepEqual(a.jsonSchema, b.jsonSchema)
  );
}

function planValidatorDiff(
  collName: string,
  originValidator: MongoSchemaValidator | undefined,
  destValidator: MongoSchemaValidator | undefined,
): MongoMigrationPlanOperation | undefined {
  if (validatorsEqual(originValidator, destValidator)) return undefined;

  if (destValidator) {
    return {
      id: `validator.${collName}.${originValidator ? 'update' : 'add'}`,
      label: `${originValidator ? 'Update' : 'Add'} validator on ${collName}`,
      operationClass: 'destructive',
      precheck: [],
      execute: [
        {
          description: `set validator on ${collName}`,
          command: new CollModCommand(collName, {
            validator: { $jsonSchema: destValidator.jsonSchema },
            validationLevel: destValidator.validationLevel,
            validationAction: destValidator.validationAction,
          }),
        },
      ],
      postcheck: [],
    };
  }

  return {
    id: `validator.${collName}.remove`,
    label: `Remove validator on ${collName}`,
    operationClass: 'destructive',
    precheck: [],
    execute: [
      {
        description: `remove validator on ${collName}`,
        command: new CollModCommand(collName, {
          validator: {},
          validationLevel: 'strict',
          validationAction: 'error',
        }),
      },
    ],
    postcheck: [],
  };
}

function hasImmutableOptionChange(
  origin: MongoSchemaCollectionOptionsNode | undefined,
  dest: MongoSchemaCollectionOptionsNode | undefined,
): string | undefined {
  if (!origin || !dest) return undefined;
  if (!deepEqual(origin.capped, dest.capped)) return 'capped';
  if (!deepEqual(origin.timeseries, dest.timeseries)) return 'timeseries';
  if (!deepEqual(origin.collation, dest.collation)) return 'collation';
  if (!deepEqual(origin.clusteredIndex, dest.clusteredIndex)) return 'clusteredIndex';
  return undefined;
}

function planCreateCollection(
  collName: string,
  dest: MongoSchemaCollection,
): MongoMigrationPlanOperation {
  const opts = dest.options;
  const validator = dest.validator;
  return {
    id: `collection.${collName}.create`,
    label: `Create collection ${collName}`,
    operationClass: 'additive',
    precheck: [
      {
        description: `collection ${collName} does not exist`,
        source: new ListCollectionsCommand(),
        filter: MongoFieldFilter.eq('name', collName),
        expect: 'notExists',
      },
    ],
    execute: [
      {
        description: `create collection ${collName}`,
        command: new CreateCollectionCommand(collName, {
          capped: opts?.capped ? true : undefined,
          size: opts?.capped?.size,
          max: opts?.capped?.max,
          timeseries: opts?.timeseries,
          collation: opts?.collation,
          clusteredIndex: opts?.clusteredIndex
            ? { key: { _id: 1 }, unique: true, name: opts.clusteredIndex.name }
            : undefined,
          validator: validator ? { $jsonSchema: validator.jsonSchema } : undefined,
          validationLevel: validator?.validationLevel,
          validationAction: validator?.validationAction,
          changeStreamPreAndPostImages: opts?.changeStreamPreAndPostImages,
        }),
      },
    ],
    postcheck: [],
  };
}

function planDropCollection(collName: string): MongoMigrationPlanOperation {
  return {
    id: `collection.${collName}.drop`,
    label: `Drop collection ${collName}`,
    operationClass: 'destructive',
    precheck: [],
    execute: [
      {
        description: `drop collection ${collName}`,
        command: new DropCollectionCommand(collName),
      },
    ],
    postcheck: [],
  };
}

function planMutableOptionsDiff(
  collName: string,
  origin: MongoSchemaCollectionOptionsNode | undefined,
  dest: MongoSchemaCollectionOptionsNode | undefined,
): MongoMigrationPlanOperation | undefined {
  const originCSPPI = origin?.changeStreamPreAndPostImages;
  const destCSPPI = dest?.changeStreamPreAndPostImages;
  if (deepEqual(originCSPPI, destCSPPI)) return undefined;

  return {
    id: `options.${collName}.update`,
    label: `Update mutable options on ${collName}`,
    operationClass: 'widening',
    precheck: [],
    execute: [
      {
        description: `update options on ${collName}`,
        command: new CollModCommand(collName, {
          changeStreamPreAndPostImages: destCSPPI,
        }),
      },
    ],
    postcheck: [],
  };
}

function collectionHasOptions(coll: MongoSchemaCollection): boolean {
  return !!(coll.options || coll.validator);
}

export class MongoMigrationPlanner implements MigrationPlanner<'mongo', 'mongo'> {
  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', 'mongo'>>;
  }): MigrationPlannerResult {
    const contract = options.contract as MongoContract;
    const originIR = options.schema as MongoSchemaIR;
    const destinationIR = contractToMongoSchemaIR(contract);

    const collCreates: MongoMigrationPlanOperation[] = [];
    const drops: MongoMigrationPlanOperation[] = [];
    const creates: MongoMigrationPlanOperation[] = [];
    const validatorOps: MongoMigrationPlanOperation[] = [];
    const mutableOptionOps: MongoMigrationPlanOperation[] = [];
    const collDrops: MongoMigrationPlanOperation[] = [];
    const conflicts: MigrationPlannerConflict[] = [];

    const allCollectionNames = new Set([
      ...Object.keys(originIR.collections),
      ...Object.keys(destinationIR.collections),
    ]);

    for (const collName of [...allCollectionNames].sort()) {
      const originColl = originIR.collections[collName];
      const destColl = destinationIR.collections[collName];

      if (!originColl && destColl) {
        if (collectionHasOptions(destColl)) {
          collCreates.push(planCreateCollection(collName, destColl));
        }
      } else if (originColl && !destColl) {
        collDrops.push(planDropCollection(collName));
      } else if (originColl && destColl) {
        const immutableChange = hasImmutableOptionChange(originColl.options, destColl.options);
        if (immutableChange) {
          conflicts.push({
            kind: 'policy-violation',
            summary: `Cannot change immutable collection option '${immutableChange}' on ${collName}`,
            why: `MongoDB does not support modifying the '${immutableChange}' option after collection creation`,
          });
        }

        const mutableOp = planMutableOptionsDiff(collName, originColl.options, destColl.options);
        if (mutableOp) mutableOptionOps.push(mutableOp);

        const validatorOp = planValidatorDiff(collName, originColl.validator, destColl.validator);
        if (validatorOp) validatorOps.push(validatorOp);
      }

      const originLookup = new Map<string, MongoSchemaIndex>();
      if (originColl) {
        for (const idx of originColl.indexes) {
          originLookup.set(buildIndexLookupKey(idx), idx);
        }
      }

      const destLookup = new Map<string, MongoSchemaIndex>();
      if (destColl) {
        for (const idx of destColl.indexes) {
          destLookup.set(buildIndexLookupKey(idx), idx);
        }
      }

      for (const [lookupKey, idx] of originLookup) {
        if (!destLookup.has(lookupKey)) {
          drops.push(planDropIndex(collName, idx));
        }
      }

      for (const [lookupKey, idx] of destLookup) {
        if (!originLookup.has(lookupKey)) {
          creates.push(planCreateIndex(collName, idx));
        }
      }
    }

    if (conflicts.length > 0) {
      return { kind: 'failure', conflicts };
    }

    const allOps = [
      ...collCreates,
      ...drops,
      ...creates,
      ...validatorOps,
      ...mutableOptionOps,
      ...collDrops,
    ];

    for (const op of allOps) {
      if (!options.policy.allowedOperationClasses.includes(op.operationClass)) {
        conflicts.push({
          kind: 'policy-violation',
          summary: `${op.operationClass} operation disallowed: ${op.label}`,
          why: `Policy does not allow '${op.operationClass}' operations`,
        });
      }
    }

    if (conflicts.length > 0) {
      return { kind: 'failure', conflicts };
    }

    return {
      kind: 'success',
      plan: {
        targetId: 'mongo',
        destination: {
          storageHash: contract.storage.storageHash,
        },
        operations: allOps,
      },
    };
  }
}
