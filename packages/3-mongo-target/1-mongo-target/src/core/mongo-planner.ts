import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  MigrationOperationClass,
  MigrationOperationPolicy,
  MigrationPlanner,
  MigrationPlannerConflict,
  MigrationPlannerResult,
} from '@prisma-next/framework-components/control';
import type { MongoContract, MongoIndexKey } from '@prisma-next/mongo-contract';
import type {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@prisma-next/mongo-schema-ir';
import { canonicalize, deepEqual } from '@prisma-next/mongo-schema-ir';
import { contractToMongoSchemaIR } from './contract-to-schema';
import type { OpFactoryCall, OpFactoryCallVisitor } from './op-factory-call';
import {
  CollModCall,
  CreateCollectionCall,
  CreateIndexCall,
  DropCollectionCall,
  DropIndexCall,
  schemaCollectionToCreateCollectionOptions,
  schemaIndexToCreateIndexOptions,
} from './op-factory-call';
import { renderOps } from './render-ops';

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

function validatorsEqual(
  a: MongoSchemaValidator | undefined,
  b: MongoSchemaValidator | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.validationLevel === b.validationLevel &&
    a.validationAction === b.validationAction &&
    canonicalize(a.jsonSchema) === canonicalize(b.jsonSchema)
  );
}

function classifyValidatorUpdate(
  origin: MongoSchemaValidator,
  dest: MongoSchemaValidator,
): 'widening' | 'destructive' {
  let hasDestructive = false;

  if (canonicalize(origin.jsonSchema) !== canonicalize(dest.jsonSchema)) {
    hasDestructive = true;
  }

  if (origin.validationAction !== dest.validationAction) {
    if (dest.validationAction === 'error') hasDestructive = true;
  }

  if (origin.validationLevel !== dest.validationLevel) {
    if (dest.validationLevel === 'strict') hasDestructive = true;
  }

  return hasDestructive ? 'destructive' : 'widening';
}

function hasImmutableOptionChange(
  origin: MongoSchemaCollectionOptions | undefined,
  dest: MongoSchemaCollectionOptions | undefined,
): string | undefined {
  if (canonicalize(origin?.capped) !== canonicalize(dest?.capped)) return 'capped';
  if (canonicalize(origin?.timeseries) !== canonicalize(dest?.timeseries)) return 'timeseries';
  if (canonicalize(origin?.collation) !== canonicalize(dest?.collation)) return 'collation';
  if (canonicalize(origin?.clusteredIndex) !== canonicalize(dest?.clusteredIndex))
    return 'clusteredIndex';
  return undefined;
}

function collectionHasOptions(coll: MongoSchemaCollection): boolean {
  return !!(coll.options || coll.validator);
}

function formatKeys(keys: ReadonlyArray<MongoIndexKey>): string {
  return keys.map((k) => `${k.field}:${k.direction}`).join(', ');
}

const operationClassVisitor: OpFactoryCallVisitor<MigrationOperationClass> = {
  createIndex() {
    return 'additive';
  },
  createCollection() {
    return 'additive';
  },
  dropIndex() {
    return 'destructive';
  },
  dropCollection() {
    return 'destructive';
  },
  collMod(call) {
    return call.meta?.operationClass ?? 'destructive';
  },
};

const labelVisitor: OpFactoryCallVisitor<string> = {
  createIndex(call) {
    return `Create index on ${call.collection} (${formatKeys(call.keys)})`;
  },
  dropIndex(call) {
    return `Drop index on ${call.collection} (${formatKeys(call.keys)})`;
  },
  createCollection(call) {
    return `Create collection ${call.collection}`;
  },
  dropCollection(call) {
    return `Drop collection ${call.collection}`;
  },
  collMod(call) {
    return call.meta?.label ?? `Modify collection ${call.collection}`;
  },
};

export type PlanCallsResult =
  | { readonly kind: 'success'; readonly calls: OpFactoryCall[] }
  | { readonly kind: 'failure'; readonly conflicts: MigrationPlannerConflict[] };

export class MongoMigrationPlanner implements MigrationPlanner<'mongo', 'mongo'> {
  planCalls(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', 'mongo'>>;
  }): PlanCallsResult {
    const contract = options.contract as MongoContract;
    const originIR = options.schema as MongoSchemaIR;
    const destinationIR = contractToMongoSchemaIR(contract);

    const collCreates: OpFactoryCall[] = [];
    const drops: OpFactoryCall[] = [];
    const creates: OpFactoryCall[] = [];
    const validatorOps: OpFactoryCall[] = [];
    const mutableOptionOps: OpFactoryCall[] = [];
    const collDrops: OpFactoryCall[] = [];
    const conflicts: MigrationPlannerConflict[] = [];

    const allCollectionNames = new Set([
      ...originIR.collectionNames,
      ...destinationIR.collectionNames,
    ]);

    for (const collName of [...allCollectionNames].sort()) {
      const originColl = originIR.collection(collName);
      const destColl = destinationIR.collection(collName);

      if (!originColl && destColl) {
        if (collectionHasOptions(destColl)) {
          const opts = schemaCollectionToCreateCollectionOptions(destColl);
          collCreates.push(new CreateCollectionCall(collName, opts));
        }
      } else if (originColl && !destColl) {
        collDrops.push(new DropCollectionCall(collName));
      } else if (originColl && destColl) {
        const immutableChange = hasImmutableOptionChange(originColl.options, destColl.options);
        if (immutableChange) {
          conflicts.push({
            kind: 'policy-violation',
            summary: `Cannot change immutable collection option '${immutableChange}' on ${collName}`,
            why: `MongoDB does not support modifying the '${immutableChange}' option after collection creation`,
          });
        }

        const mutableCall = planMutableOptionsDiffCall(
          collName,
          originColl.options,
          destColl.options,
        );
        if (mutableCall) mutableOptionOps.push(mutableCall);

        const validatorCall = planValidatorDiffCall(
          collName,
          originColl.validator,
          destColl.validator,
        );
        if (validatorCall) validatorOps.push(validatorCall);
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
          drops.push(new DropIndexCall(collName, idx.keys));
        }
      }

      for (const [lookupKey, idx] of destLookup) {
        if (!originLookup.has(lookupKey)) {
          creates.push(
            new CreateIndexCall(collName, idx.keys, schemaIndexToCreateIndexOptions(idx)),
          );
        }
      }
    }

    if (conflicts.length > 0) {
      return { kind: 'failure', conflicts };
    }

    const allCalls = [
      ...collCreates,
      ...drops,
      ...creates,
      ...validatorOps,
      ...mutableOptionOps,
      ...collDrops,
    ];

    for (const call of allCalls) {
      const opClass = call.accept(operationClassVisitor);
      if (!options.policy.allowedOperationClasses.includes(opClass)) {
        conflicts.push({
          kind: 'policy-violation',
          summary: `${opClass} operation disallowed: ${call.accept(labelVisitor)}`,
          why: `Policy does not allow '${opClass}' operations`,
        });
      }
    }

    if (conflicts.length > 0) {
      return { kind: 'failure', conflicts };
    }

    return { kind: 'success', calls: allCalls };
  }

  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', 'mongo'>>;
  }): MigrationPlannerResult {
    const contract = options.contract as MongoContract;
    const result = this.planCalls(options);
    if (result.kind === 'failure') return result;
    return {
      kind: 'success',
      plan: {
        targetId: 'mongo',
        destination: {
          storageHash: contract.storage.storageHash,
        },
        operations: renderOps(result.calls),
      },
    };
  }
}

function planValidatorDiffCall(
  collName: string,
  originValidator: MongoSchemaValidator | undefined,
  destValidator: MongoSchemaValidator | undefined,
): OpFactoryCall | undefined {
  if (validatorsEqual(originValidator, destValidator)) return undefined;

  if (destValidator) {
    const operationClass: MigrationOperationClass = originValidator
      ? classifyValidatorUpdate(originValidator, destValidator)
      : 'destructive';
    return new CollModCall(
      collName,
      {
        validator: { $jsonSchema: destValidator.jsonSchema },
        validationLevel: destValidator.validationLevel,
        validationAction: destValidator.validationAction,
      },
      {
        id: `validator.${collName}.${originValidator ? 'update' : 'add'}`,
        label: `${originValidator ? 'Update' : 'Add'} validator on ${collName}`,
        operationClass,
      },
    );
  }

  return new CollModCall(
    collName,
    {
      validator: {},
      validationLevel: 'strict',
      validationAction: 'error',
    },
    {
      id: `validator.${collName}.remove`,
      label: `Remove validator on ${collName}`,
      operationClass: 'widening',
    },
  );
}

function planMutableOptionsDiffCall(
  collName: string,
  origin: MongoSchemaCollectionOptions | undefined,
  dest: MongoSchemaCollectionOptions | undefined,
): OpFactoryCall | undefined {
  const originCSPPI = origin?.changeStreamPreAndPostImages;
  const destCSPPI = dest?.changeStreamPreAndPostImages;
  if (deepEqual(originCSPPI, destCSPPI)) return undefined;

  return new CollModCall(
    collName,
    {
      changeStreamPreAndPostImages: destCSPPI,
    },
    {
      id: `options.${collName}.update`,
      label: `Update mutable options on ${collName}`,
      operationClass: destCSPPI?.enabled ? 'widening' : 'destructive',
    },
  );
}
