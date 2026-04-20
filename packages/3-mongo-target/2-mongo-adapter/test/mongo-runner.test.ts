import { MongoDriverImpl } from '@prisma-next/driver-mongo';
import type {
  MigrationPlan,
  MigrationPlanOperation,
} from '@prisma-next/framework-components/control';
import type { AnyMongoMigrationOperation } from '@prisma-next/mongo-query-ast/control';
import {
  MongoSchemaCollection,
  MongoSchemaIndex,
  MongoSchemaIR,
} from '@prisma-next/mongo-schema-ir';
import {
  initMarker,
  MongoMigrationPlanner,
  MongoMigrationRunner,
  readMarker,
  serializeMongoOps,
} from '@prisma-next/target-mongo/control';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMongoControlDriver } from '../src/core/mongo-control-driver';
import { createMongoRunnerDeps } from '../src/core/runner-deps';

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
const dbName = 'runner_test';

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = new MongoClient(replSet.getUri());
  await client.connect();
  db = client.db(dbName);
});

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    await db.dropCollection(col['name'] as string);
  }
});

function makeContract(
  collections: Record<
    string,
    {
      indexes?: Array<{
        keys: Array<{ field: string; direction: 1 | -1 }>;
        unique?: boolean;
        sparse?: boolean;
      }>;
    }
  >,
  storageHash = 'sha256:dest',
) {
  const storageCollections: Record<string, Record<string, unknown>> = {};
  for (const [name, def] of Object.entries(collections)) {
    storageCollections[name] = { indexes: def.indexes ?? [] };
  }
  return {
    storage: {
      storageHash,
      collections: storageCollections,
    },
  };
}

function planForContract(
  contract: ReturnType<typeof makeContract>,
  origin: MongoSchemaIR = new MongoSchemaIR([]),
  fromHash = '',
) {
  const planner = new MongoMigrationPlanner();
  const result = planner.plan({
    contract,
    schema: origin,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromHash,
    frameworkComponents: [],
  });
  if (result.kind !== 'success') throw new Error('Planner failed unexpectedly');
  return result.plan;
}

function serializePlan(plan: MigrationPlan): MigrationPlan {
  const serialized = JSON.parse(serializeMongoOps(plan.operations as AnyMongoMigrationOperation[]));
  // Accessor properties on `PlannerProducedMongoMigration` (operations, origin,
  // destination) live on the prototype, so we can't use spread here. Rebuild a
  // plain plan object instead.
  return {
    targetId: plan.targetId,
    operations: serialized,
    origin: plan.origin ?? null,
    destination: plan.destination,
  };
}

function makeRunner() {
  return new MongoMigrationRunner(
    createMongoRunnerDeps(createMongoControlDriver(db, client), MongoDriverImpl.fromDb(db)),
  );
}

describe('MongoMigrationRunner', () => {
  it('creates an index on a real MongoDB instance', async () => {
    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }], unique: true }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,
      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.operationsExecuted).toBe(1);
    }

    const indexes = await db.collection('users').listIndexes().toArray();
    const emailIndex = indexes.find((idx) => idx['key']?.['email'] === 1);
    expect(emailIndex).toBeDefined();
    expect(emailIndex?.['unique']).toBe(true);
  });

  it('drops an index from a real MongoDB instance', async () => {
    await db.createCollection('posts');
    await db.collection('posts').createIndex({ title: 1 }, { name: 'title_1' });

    const originIR = new MongoSchemaIR([
      new MongoSchemaCollection({
        name: 'posts',
        indexes: [
          new MongoSchemaIndex({
            keys: [{ field: 'title', direction: 1 }],
          }),
        ],
      }),
    ]);
    const contract = makeContract({ posts: {} }, 'sha256:dropped');
    const plan = planForContract(contract, originIR);
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);

    const indexes = await db.collection('posts').listIndexes().toArray();
    const titleIndex = indexes.find((idx) => idx['name'] === 'title_1');
    expect(titleIndex).toBeUndefined();
  });

  it('skips already-applied operations via idempotency probe', async () => {
    await db.createCollection('items');
    await db.collection('items').createIndex({ sku: 1 }, { unique: true, name: 'sku_1' });

    const contract = makeContract({
      items: { indexes: [{ keys: [{ field: 'sku', direction: 1 }], unique: true }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.operationsExecuted).toBe(0);
    }
  });

  it('returns PRECHECK_FAILED when prechecks fail', async () => {
    await db.createCollection('users');
    await db.collection('users').createIndex({ email: 1 }, { name: 'email_1' });

    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      executionChecks: { idempotencyChecks: false },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('PRECHECK_FAILED');
    }
  });

  it('executes multiple operations in order', async () => {
    const contract = makeContract({
      alpha: { indexes: [{ keys: [{ field: 'a', direction: 1 }] }] },
      beta: { indexes: [{ keys: [{ field: 'b', direction: 1 }] }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const executedOps: string[] = [];
    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      callbacks: {
        onOperationStart(op: MigrationPlanOperation) {
          executedOps.push(op.id);
        },
      },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.operationsExecuted).toBe(2);
    }
    expect(executedOps).toHaveLength(2);

    const alphaIndexes = await db.collection('alpha').listIndexes().toArray();
    expect(alphaIndexes.some((idx) => idx['key']?.['a'] === 1)).toBe(true);

    const betaIndexes = await db.collection('beta').listIndexes().toArray();
    expect(betaIndexes.some((idx) => idx['key']?.['b'] === 1)).toBe(true);
  });

  it('returns MARKER_ORIGIN_MISMATCH when marker hash differs', async () => {
    await initMarker(db, { storageHash: 'sha256:different', profileHash: 'sha256:p1' });

    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
    });
    const plan = planForContract(contract, undefined, 'sha256:expected');
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MARKER_ORIGIN_MISMATCH');
    }
  });

  it('returns MARKER_ORIGIN_MISMATCH when marker exists but plan has no origin', async () => {
    await initMarker(db, { storageHash: 'sha256:existing', profileHash: 'sha256:p1' });

    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MARKER_ORIGIN_MISMATCH');
    }
  });

  it('returns MARKER_ORIGIN_MISMATCH when no marker but plan has origin', async () => {
    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
    });
    const plan = planForContract(contract, undefined, 'sha256:something');
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MARKER_ORIGIN_MISMATCH');
    }
  });

  it('returns MARKER_CAS_FAILURE when concurrent marker change causes CAS miss', async () => {
    await initMarker(db, { storageHash: 'sha256:origin', profileHash: 'sha256:profile' });

    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
    });
    const plan = planForContract(contract, undefined, 'sha256:origin');
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      callbacks: {
        async onOperationComplete() {
          await db
            .collection('_prisma_migrations')
            .updateOne(
              { _id: 'marker' as never },
              { $set: { storageHash: 'sha256:tampered-by-other-process' } },
            );
        },
      },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MARKER_CAS_FAILURE');
    }
  });

  it('returns POLICY_VIOLATION for disallowed operation class', async () => {
    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,

      destinationContract: contract,
      policy: { allowedOperationClasses: ['destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('POLICY_VIOLATION');
    }
  });

  it('updates marker and writes ledger entry after successful execution', async () => {
    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    await runner.execute({
      plan: serialized,

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    const marker = await readMarker(db);
    expect(marker).not.toBeNull();
    expect(marker?.storageHash).toBe('sha256:dest');

    const ledgerEntries = await db
      .collection('_prisma_migrations')
      .find({ type: 'ledger' })
      .toArray();
    expect(ledgerEntries).toHaveLength(1);
  });
});

describe('MongoMigrationRunner - data transforms', () => {
  function makeDataTransformPlan(ops: unknown[]): MigrationPlan {
    return {
      targetId: 'mongo',
      operations: ops as MigrationPlanOperation[],
      destination: { storageHash: 'sha256:dest-dt' },
    };
  }

  function makeCheckSource(collection: string) {
    return {
      collection,
      command: {
        kind: 'rawAggregate',
        collection,
        pipeline: [{ $match: { status: { $exists: false } } }, { $limit: 1 }],
      },
      meta: { target: 'mongo', storageHash: 'sha256:x', lane: 'mongo-raw', paramDescriptors: [] },
    };
  }

  function makePrecheckObj(collection: string) {
    return {
      description: `Check for ${collection}`,
      source: makeCheckSource(collection),
      filter: { kind: 'exists', field: '_id', exists: true },
      expect: 'exists' as const,
    };
  }

  function makePostcheckObj(collection: string) {
    return {
      description: `Check for ${collection}`,
      source: makeCheckSource(collection),
      filter: { kind: 'exists', field: '_id', exists: true },
      expect: 'notExists' as const,
    };
  }

  it('executes a data transform with empty precheck (always run)', async () => {
    await db.createCollection('users');

    const op = {
      id: 'data_transform.backfill',
      label: 'Data transform: backfill',
      operationClass: 'data',
      name: 'backfill',
      precheck: [],
      run: [
        {
          collection: 'users',
          command: {
            kind: 'rawInsertMany',
            collection: 'users',
            documents: [{ name: 'Alice' }, { name: 'Bob' }],
          },
          meta: {
            target: 'mongo',
            storageHash: 'sha256:x',
            lane: 'mongo-raw',
            paramDescriptors: [],
          },
        },
      ],
      postcheck: [],
    };

    const runner = makeRunner();
    const result = await runner.execute({
      plan: makeDataTransformPlan([op]),
      destinationContract: { storageHash: 'sha256:dest-dt' },
      policy: { allowedOperationClasses: ['data'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.operationsExecuted).toBe(1);
    }

    const docs = await db.collection('users').find().toArray();
    expect(docs).toHaveLength(2);
  });

  it('skips via idempotency check when postcheck query returns empty', async () => {
    await db.createCollection('users');

    const op = {
      id: 'data_transform.backfill',
      label: 'Data transform: backfill',
      operationClass: 'data',
      name: 'backfill',
      precheck: [makePrecheckObj('users')],
      run: [
        {
          collection: 'users',
          command: {
            kind: 'rawUpdateMany',
            collection: 'users',
            filter: { status: { $exists: false } },
            update: { $set: { status: 'active' } },
          },
          meta: {
            target: 'mongo',
            storageHash: 'sha256:x',
            lane: 'mongo-raw',
            paramDescriptors: [],
          },
        },
      ],
      postcheck: [makePostcheckObj('users')],
    };

    const runner = makeRunner();
    const result = await runner.execute({
      plan: makeDataTransformPlan([op]),
      destinationContract: { storageHash: 'sha256:dest-dt' },
      policy: { allowedOperationClasses: ['data'] },
      frameworkComponents: [],
    });

    // Empty collection ⇒ postcheck (`expect: 'notExists'` on docs missing
    // `status`) is satisfied up-front, so the data transform is skipped and
    // does not contribute to `operationsExecuted`.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.operationsExecuted).toBe(0);
    }
  });

  it('executes run when check query finds violations', async () => {
    await db.createCollection('users');
    await db.collection('users').insertMany([{ name: 'Alice' }, { name: 'Bob' }]);

    const op = {
      id: 'data_transform.backfill-status',
      label: 'Data transform: backfill-status',
      operationClass: 'data',
      name: 'backfill-status',
      precheck: [makePrecheckObj('users')],
      run: [
        {
          collection: 'users',
          command: {
            kind: 'rawUpdateMany',
            collection: 'users',
            filter: { status: { $exists: false } },
            update: { $set: { status: 'active' } },
          },
          meta: {
            target: 'mongo',
            storageHash: 'sha256:x',
            lane: 'mongo-raw',
            paramDescriptors: [],
          },
        },
      ],
      postcheck: [makePostcheckObj('users')],
    };

    const runner = makeRunner();
    const result = await runner.execute({
      plan: makeDataTransformPlan([op]),
      destinationContract: { storageHash: 'sha256:dest-dt' },
      policy: { allowedOperationClasses: ['data'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);

    const docs = await db.collection('users').find().toArray();
    expect(docs.every((d) => d['status'] === 'active')).toBe(true);
  });

  it('returns POSTCHECK_FAILED when run does not fix all violations', async () => {
    await db.createCollection('users');
    await db.collection('users').insertMany([{ name: 'Alice' }, { name: 'Bob' }]);

    const op = {
      id: 'data_transform.partial-fix',
      label: 'Data transform: partial-fix',
      operationClass: 'data',
      name: 'partial-fix',
      precheck: [makePrecheckObj('users')],
      run: [
        {
          collection: 'users',
          command: {
            kind: 'rawUpdateOne',
            collection: 'users',
            filter: { name: 'Alice' },
            update: { $set: { status: 'active' } },
          },
          meta: {
            target: 'mongo',
            storageHash: 'sha256:x',
            lane: 'mongo-raw',
            paramDescriptors: [],
          },
        },
      ],
      postcheck: [makePostcheckObj('users')],
    };

    const runner = makeRunner();
    const result = await runner.execute({
      plan: makeDataTransformPlan([op]),
      destinationContract: { storageHash: 'sha256:dest-dt' },
      policy: { allowedOperationClasses: ['data'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('POSTCHECK_FAILED');
    }
  });

  it('returns POLICY_VIOLATION when data class not allowed', async () => {
    const op = {
      id: 'data_transform.test',
      label: 'Data transform: test',
      operationClass: 'data',
      name: 'test',
      precheck: [],
      run: [],
      postcheck: [],
    };

    const runner = makeRunner();
    const result = await runner.execute({
      plan: makeDataTransformPlan([op]),
      destinationContract: { storageHash: 'sha256:dest-dt' },
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('POLICY_VIOLATION');
    }
  });
});

describe('MongoMigrationRunner - E2E round-trip', () => {
  it('serialize → deserialize → execute mixed DDL + data transform', async () => {
    const { dataTransform } = await import('@prisma-next/target-mongo/migration');
    const { RawUpdateManyCommand, RawAggregateCommand } = await import(
      '@prisma-next/mongo-query-ast/execution'
    );

    const planner = new MongoMigrationPlanner();
    const contract = makeContract({
      orders: { indexes: [{ keys: [{ field: 'createdAt', direction: -1 }] }] },
    });
    const ddlResult = planner.plan({
      contract,
      schema: new MongoSchemaIR([]),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromHash: 'sha256:00',
      frameworkComponents: [],
    });
    if (ddlResult.kind !== 'success') throw new Error('Planner failed');

    const dtOp = dataTransform('backfill-status', {
      check: {
        source: () => ({
          collection: 'orders',
          command: new RawAggregateCommand('orders', [
            { $match: { status: { $exists: false } } },
            { $limit: 1 },
          ]),
          meta: {
            target: 'mongo',
            storageHash: 'sha256:x',
            lane: 'mongo-raw',
            paramDescriptors: [],
          },
        }),
      },
      run: () => ({
        collection: 'orders',
        command: new RawUpdateManyCommand(
          'orders',
          { status: { $exists: false } },
          { $set: { status: 'pending' } },
        ),
        meta: { target: 'mongo', storageHash: 'sha256:x', lane: 'mongo-raw', paramDescriptors: [] },
      }),
    });

    const allOps = [...ddlResult.plan.operations, dtOp] as AnyMongoMigrationOperation[];

    const serializedJson = serializeMongoOps(allOps);

    const plan: MigrationPlan = {
      targetId: 'mongo',
      operations: JSON.parse(serializedJson) as MigrationPlanOperation[],
      destination: { storageHash: 'sha256:dest-e2e' },
    };

    // Seed a row that needs the backfill so the data transform actually runs;
    // without seed data the postcheck (`status` exists on every doc) is
    // trivially satisfied and the runner would skip it.
    await db.createCollection('orders');
    await db.collection('orders').insertOne({ ref: 'A1' });

    const runner = makeRunner();
    const result = await runner.execute({
      plan,
      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
      frameworkComponents: [],
    });

    // 1 createIndex (the planner does not emit createCollection for plain
    // collections without options/validators) + 1 data transform that
    // backfills the seeded row.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.operationsExecuted).toBe(2);
    }

    const indexes = await db.collection('orders').listIndexes().toArray();
    const createdAtIdx = indexes.find((idx) => idx['key']?.['createdAt'] === -1);
    expect(createdAtIdx).toBeDefined();

    const orders = await db.collection('orders').find().toArray();
    expect(orders.every((o) => o['status'] === 'pending')).toBe(true);
  });

  it('retry safety: re-running completed data transform is skipped by postcheck', async () => {
    await db.createCollection('accounts');
    await db.collection('accounts').insertMany([{ name: 'Acme', active: true }, { name: 'Beta' }]);

    const checkSource = {
      collection: 'accounts',
      command: {
        kind: 'rawAggregate' as const,
        collection: 'accounts',
        pipeline: [{ $match: { active: { $exists: false } } }, { $limit: 1 }],
      },
      meta: { target: 'mongo', storageHash: 'sha256:x', lane: 'mongo-raw', paramDescriptors: [] },
    };

    const op = {
      id: 'data_transform.backfill-active',
      label: 'Data transform: backfill-active',
      operationClass: 'data' as const,
      name: 'backfill-active',
      precheck: [
        {
          description: 'Check for accounts',
          source: checkSource,
          filter: { kind: 'exists', field: '_id', exists: true },
          expect: 'exists' as const,
        },
      ],
      run: [
        {
          collection: 'accounts',
          command: {
            kind: 'rawUpdateMany' as const,
            collection: 'accounts',
            filter: { active: { $exists: false } },
            update: { $set: { active: false } },
          },
          meta: {
            target: 'mongo',
            storageHash: 'sha256:x',
            lane: 'mongo-raw',
            paramDescriptors: [],
          },
        },
      ],
      postcheck: [
        {
          description: 'Check for accounts',
          source: checkSource,
          filter: { kind: 'exists', field: '_id', exists: true },
          expect: 'notExists' as const,
        },
      ],
    };

    const plan: MigrationPlan = {
      targetId: 'mongo',
      operations: [op] as unknown as MigrationPlanOperation[],
      destination: { storageHash: 'sha256:retry' },
    };

    const runner = makeRunner();

    const result1 = await runner.execute({
      plan,
      destinationContract: { storageHash: 'sha256:retry' },
      policy: { allowedOperationClasses: ['data'] },
      frameworkComponents: [],
    });
    expect(result1.ok).toBe(true);

    const docsAfterFirst = await db.collection('accounts').find().toArray();
    expect(docsAfterFirst.every((d) => typeof d['active'] === 'boolean')).toBe(true);

    await db.collection('_prisma_migrations').drop();

    const result2 = await runner.execute({
      plan,
      destinationContract: { storageHash: 'sha256:retry' },
      policy: { allowedOperationClasses: ['data'] },
      frameworkComponents: [],
    });
    // Marker has been wiped, but the postcheck (no docs missing `active`) is
    // already satisfied, so the runner skips the data transform without
    // counting it as executed.
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.value.operationsExecuted).toBe(0);
    }
  });
});

describe('MongoControlDriver', () => {
  it('query() throws because MongoDB does not support SQL', () => {
    const driver = createMongoControlDriver(db, client);
    expect(() => driver.query('SELECT 1')).toThrow(
      'MongoDB control driver does not support SQL queries',
    );
  });

  it('close() delegates to the underlying MongoClient', async () => {
    const closeClient = new MongoClient(replSet.getUri());
    await closeClient.connect();
    const closeDb = closeClient.db('close_test');
    const driver = createMongoControlDriver(closeDb, closeClient);

    await driver.close();

    await expect(closeClient.db('close_test').command({ ping: 1 })).rejects.toThrow();
  });
});
