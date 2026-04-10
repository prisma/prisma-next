import type {
  MigrationPlan,
  MigrationPlanOperation,
} from '@prisma-next/framework-components/control';
import type { MongoMigrationPlanOperation } from '@prisma-next/mongo-query-ast/control';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initMarker, readMarker } from '../src/core/marker-ledger';
import { createMongoControlDriver } from '../src/core/mongo-control-driver';
import { serializeMongoOps } from '../src/core/mongo-ops-serializer';
import { MongoMigrationPlanner } from '../src/core/mongo-planner';
import { MongoMigrationRunner } from '../src/core/mongo-runner';

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
  origin: { collections: Record<string, { indexes: never[] }> } = { collections: {} },
) {
  const planner = new MongoMigrationPlanner();
  const result = planner.plan({
    contract,
    schema: origin,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    frameworkComponents: [],
  });
  if (result.kind !== 'success') throw new Error('Planner failed unexpectedly');
  return result.plan;
}

function serializePlan(plan: MigrationPlan): MigrationPlan {
  const serialized = JSON.parse(
    serializeMongoOps(plan.operations as MongoMigrationPlanOperation[]),
  );
  return { ...plan, operations: serialized };
}

function makeDriver() {
  return createMongoControlDriver(db, client);
}

describe('MongoMigrationRunner', () => {
  it('creates an index on a real MongoDB instance', async () => {
    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }], unique: true }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const runner = new MongoMigrationRunner();
    const result = await runner.execute({
      plan: serialized,
      driver: makeDriver(),
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

    const originIR = {
      collections: {
        posts: {
          name: 'posts',
          indexes: [
            {
              name: 'title_1',
              keys: [{ field: 'title', direction: 1 as const }],
              unique: false,
              sparse: false,
            },
          ],
        },
      },
    };
    const contract = makeContract({ posts: {} }, 'sha256:dropped');
    const plan = planForContract(contract, originIR as never);
    const serialized = serializePlan(plan);

    const runner = new MongoMigrationRunner();
    const result = await runner.execute({
      plan: serialized,
      driver: makeDriver(),
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

    const runner = new MongoMigrationRunner();
    const result = await runner.execute({
      plan: serialized,
      driver: makeDriver(),
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

    const runner = new MongoMigrationRunner();
    const result = await runner.execute({
      plan: serialized,
      driver: makeDriver(),
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
    const runner = new MongoMigrationRunner();
    const result = await runner.execute({
      plan: serialized,
      driver: makeDriver(),
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
    const plan = planForContract(contract);
    const serialized = serializePlan({
      ...plan,
      origin: { storageHash: 'sha256:expected' },
    });

    const runner = new MongoMigrationRunner();
    const result = await runner.execute({
      plan: serialized,
      driver: makeDriver(),
      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MARKER_ORIGIN_MISMATCH');
    }
  });

  it('returns POLICY_VIOLATION for disallowed operation class', async () => {
    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const runner = new MongoMigrationRunner();
    const result = await runner.execute({
      plan: serialized,
      driver: makeDriver(),
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

    const runner = new MongoMigrationRunner();
    await runner.execute({
      plan: serialized,
      driver: makeDriver(),
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
