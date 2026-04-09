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
  CreateIndexCommand,
  DropIndexCommand,
  defaultMongoIndexName,
  keysToKeySpec,
  ListIndexesCommand,
  MongoAndExpr,
  MongoFieldFilter,
  type MongoMigrationPlanOperation,
} from '@prisma-next/mongo-query-ast/control';
import type { MongoSchemaIndex, MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import { contractToMongoSchemaIR } from './contract-to-schema';

function buildIndexLookupKey(index: MongoSchemaIndex): string {
  const keys = index.keys.map((k) => `${k.field}:${k.direction}`).join(',');
  const opts = [
    index.unique ? 'unique' : '',
    index.sparse ? 'sparse' : '',
    index.expireAfterSeconds != null ? `ttl:${index.expireAfterSeconds}` : '',
    index.partialFilterExpression ? `pfe:${JSON.stringify(index.partialFilterExpression)}` : '',
  ]
    .filter(Boolean)
    .join(';');
  return opts ? `${keys}|${opts}` : keys;
}

function formatKeys(keys: ReadonlyArray<MongoIndexKey>): string {
  return keys.map((k) => `${k.field}:${k.direction}`).join(', ');
}

function planCreateIndex(collection: string, index: MongoSchemaIndex): MongoMigrationPlanOperation {
  const { keys } = index;
  const name = defaultMongoIndexName(keys);
  const keyFilter = MongoFieldFilter.eq('key', keysToKeySpec(keys));
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
  const keyFilter = MongoFieldFilter.eq('key', keysToKeySpec(keys));

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

    const drops: MongoMigrationPlanOperation[] = [];
    const creates: MongoMigrationPlanOperation[] = [];

    const allCollectionNames = new Set([
      ...Object.keys(originIR.collections),
      ...Object.keys(destinationIR.collections),
    ]);

    for (const collName of [...allCollectionNames].sort()) {
      const originColl = originIR.collections[collName];
      const destColl = destinationIR.collections[collName];

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

    const allOps = [...drops, ...creates];

    const conflicts: MigrationPlannerConflict[] = [];
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
