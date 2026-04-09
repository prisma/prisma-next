import {
  contractToMongoSchemaIR,
  MongoMigrationPlanner,
  MongoMigrationRunner,
  readMarker,
  serializeMongoOps,
} from '@prisma-next/adapter-mongo/control';
import mongoControlDriver from '@prisma-next/driver-mongo/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import { timeouts } from '@prisma-next/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const MIGRATIONS_COLLECTION = '_prisma_migrations';

const emptyContract: MongoContract = {
  roots: { users: 'User' },
  models: {
    User: {
      fields: {
        _id: { nullable: false, codecId: 'mongo/objectId@1' },
        email: { nullable: false, codecId: 'mongo/string@1' },
      },
      relations: {},
      storage: { collection: 'users' },
    },
  },
  storage: {
    collections: {
      users: {},
    },
    storageHash: 'sha256:empty-contract',
  },
};

const indexedContract: MongoContract = {
  roots: { users: 'User' },
  models: {
    User: {
      fields: {
        _id: { nullable: false, codecId: 'mongo/objectId@1' },
        email: { nullable: false, codecId: 'mongo/string@1' },
      },
      relations: {},
      storage: { collection: 'users' },
    },
  },
  storage: {
    collections: {
      users: {
        indexes: [{ keys: [{ field: 'email', direction: 1 }], unique: true }],
      },
    },
    storageHash: 'sha256:indexed-contract',
  },
};

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

describe('MongoDB migration E2E', { timeout: timeouts.spinUpDbServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  const dbName = 'migration_e2e_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [{ launchTimeout: timeouts.spinUpDbServer, storageEngine: 'wiredTiger' }],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    db = client.db(dbName);
  }, timeouts.spinUpDbServer);

  beforeEach(async () => {
    await db.dropDatabase();
  });

  afterAll(async () => {
    try {
      await client?.close();
      await replSet?.stop();
    } catch {
      // Ignore cleanup errors
    }
  }, timeouts.spinUpDbServer);

  describe('plan + apply create index', () => {
    it('plans a createIndex operation from empty to indexed contract', () => {
      const planner = new MongoMigrationPlanner();
      const schema = contractToMongoSchemaIR(null);
      const result = planner.plan({
        contract: indexedContract,
        schema,
        policy: ALL_POLICY,
        frameworkComponents: [],
      });

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') return;

      expect(result.plan.operations).toHaveLength(1);
      const op = result.plan.operations[0]!;
      expect(op.operationClass).toBe('additive');
      expect(op.label).toContain('Create index');
      expect(op.label).toContain('users');
    });

    it('applies createIndex and verifies the index exists on MongoDB', async () => {
      const planner = new MongoMigrationPlanner();
      const schema = contractToMongoSchemaIR(null);
      const result = planner.plan({
        contract: indexedContract,
        schema,
        policy: ALL_POLICY,
        frameworkComponents: [],
      });
      if (result.kind !== 'success') throw new Error('Plan failed unexpectedly');

      const serialized = JSON.parse(serializeMongoOps(result.plan.operations));

      const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const runner = new MongoMigrationRunner();
        const runResult = await runner.execute({
          plan: {
            targetId: 'mongo',
            destination: { storageHash: indexedContract.storage.storageHash },
            operations: serialized,
          },
          driver: controlDriver,
          destinationContract: indexedContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });

        expect(runResult.ok).toBe(true);
        if (!runResult.ok) return;
        expect(runResult.value.operationsPlanned).toBe(1);
        expect(runResult.value.operationsExecuted).toBe(1);

        const indexes = await db.collection('users').listIndexes().toArray();
        const emailIndex = indexes.find((idx) => idx['key'] && idx['key']['email'] === 1);
        expect(emailIndex).toBeDefined();
        expect(emailIndex!['unique']).toBe(true);
      } finally {
        await controlDriver.close();
      }
    });

    it('updates the marker with the destination hash', async () => {
      const planner = new MongoMigrationPlanner();
      const schema = contractToMongoSchemaIR(null);
      const result = planner.plan({
        contract: indexedContract,
        schema,
        policy: ALL_POLICY,
        frameworkComponents: [],
      });
      if (result.kind !== 'success') throw new Error('Plan failed');

      const serialized = JSON.parse(serializeMongoOps(result.plan.operations));

      const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const runner = new MongoMigrationRunner();
        await runner.execute({
          plan: {
            targetId: 'mongo',
            destination: { storageHash: indexedContract.storage.storageHash },
            operations: serialized,
          },
          driver: controlDriver,
          destinationContract: indexedContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });

        const marker = await readMarker(db);
        expect(marker).not.toBeNull();
        expect(marker!.storageHash).toBe(indexedContract.storage.storageHash);
      } finally {
        await controlDriver.close();
      }
    });

    it('records a ledger entry', async () => {
      const planner = new MongoMigrationPlanner();
      const schema = contractToMongoSchemaIR(null);
      const result = planner.plan({
        contract: indexedContract,
        schema,
        policy: ALL_POLICY,
        frameworkComponents: [],
      });
      if (result.kind !== 'success') throw new Error('Plan failed');

      const serialized = JSON.parse(serializeMongoOps(result.plan.operations));

      const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const runner = new MongoMigrationRunner();
        await runner.execute({
          plan: {
            targetId: 'mongo',
            destination: { storageHash: indexedContract.storage.storageHash },
            operations: serialized,
          },
          driver: controlDriver,
          destinationContract: indexedContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });

        const ledgerEntries = await db
          .collection(MIGRATIONS_COLLECTION)
          .find({ type: 'ledger' })
          .toArray();
        expect(ledgerEntries).toHaveLength(1);
        expect(ledgerEntries[0]!['to']).toBe(indexedContract.storage.storageHash);
      } finally {
        await controlDriver.close();
      }
    });
  });

  describe('plan + apply drop index', () => {
    it('drops an index when the destination contract removes it', async () => {
      const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const planner = new MongoMigrationPlanner();
        const runner = new MongoMigrationRunner();

        // Step 1: Apply create index
        const createSchema = contractToMongoSchemaIR(null);
        const createResult = planner.plan({
          contract: indexedContract,
          schema: createSchema,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });
        if (createResult.kind !== 'success') throw new Error('Create plan failed');

        const createSerialized = JSON.parse(serializeMongoOps(createResult.plan.operations));
        await runner.execute({
          plan: {
            targetId: 'mongo',
            destination: { storageHash: indexedContract.storage.storageHash },
            operations: createSerialized,
          },
          driver: controlDriver,
          destinationContract: indexedContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });

        // Verify index exists
        let indexes = await db.collection('users').listIndexes().toArray();
        expect(indexes.some((idx) => idx['key']?.['email'] === 1)).toBe(true);

        // Step 2: Plan drop (indexed -> empty)
        const dropSchema = contractToMongoSchemaIR(indexedContract);
        const dropResult = planner.plan({
          contract: emptyContract,
          schema: dropSchema,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });
        if (dropResult.kind !== 'success') throw new Error('Drop plan failed');

        expect(dropResult.plan.operations).toHaveLength(1);
        expect(dropResult.plan.operations[0]!.operationClass).toBe('destructive');
        expect(dropResult.plan.operations[0]!.label).toContain('Drop index');

        // Step 3: Apply drop
        const dropSerialized = JSON.parse(serializeMongoOps(dropResult.plan.operations));
        const dropRunResult = await runner.execute({
          plan: {
            targetId: 'mongo',
            origin: { storageHash: indexedContract.storage.storageHash },
            destination: { storageHash: emptyContract.storage.storageHash },
            operations: dropSerialized,
          },
          driver: controlDriver,
          destinationContract: emptyContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });

        expect(dropRunResult.ok).toBe(true);

        // Verify index is gone (only _id index remains)
        indexes = await db.collection('users').listIndexes().toArray();
        const emailIndex = indexes.find((idx) => idx['key']?.['email'] === 1);
        expect(emailIndex).toBeUndefined();

        // Verify marker updated
        const marker = await readMarker(db);
        expect(marker!.storageHash).toBe(emptyContract.storage.storageHash);

        // Verify second ledger entry with correct target hash
        const ledgerEntries = await db
          .collection(MIGRATIONS_COLLECTION)
          .find({ type: 'ledger' })
          .toArray();
        expect(ledgerEntries).toHaveLength(2);
        const dropLedger = ledgerEntries.find((e) => e['to'] === emptyContract.storage.storageHash);
        expect(dropLedger).toBeDefined();
        expect(dropLedger!['from']).toBe(indexedContract.storage.storageHash);
      } finally {
        await controlDriver.close();
      }
    });
  });

  describe('idempotent re-apply', () => {
    it('skips operations when postchecks already satisfied', async () => {
      const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const planner = new MongoMigrationPlanner();
        const runner = new MongoMigrationRunner();

        // First apply
        const schema = contractToMongoSchemaIR(null);
        const result = planner.plan({
          contract: indexedContract,
          schema,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });
        if (result.kind !== 'success') throw new Error('Plan failed');

        const serialized = JSON.parse(serializeMongoOps(result.plan.operations));
        const bootstrapPlan = {
          targetId: 'mongo' as const,
          destination: { storageHash: indexedContract.storage.storageHash },
          operations: serialized,
        };

        await runner.execute({
          plan: bootstrapPlan,
          driver: controlDriver,
          destinationContract: indexedContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });

        // Second apply (same plan with origin) — idempotent
        const reapplyPlan = {
          ...bootstrapPlan,
          origin: { storageHash: indexedContract.storage.storageHash },
        };
        const reapplyResult = await runner.execute({
          plan: reapplyPlan,
          driver: controlDriver,
          destinationContract: indexedContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
          executionChecks: { prechecks: true, postchecks: true, idempotencyChecks: true },
        });

        expect(reapplyResult.ok).toBe(true);
        if (!reapplyResult.ok) return;
        expect(reapplyResult.value.operationsPlanned).toBe(1);
        expect(reapplyResult.value.operationsExecuted).toBe(0);
      } finally {
        await controlDriver.close();
      }
    });
  });

  describe('full lifecycle via control driver descriptor', () => {
    it('create(url) produces a driver compatible with the migration runner', async () => {
      const url = replSet.getUri(dbName);
      const controlDriver = await mongoControlDriver.create(url);
      try {
        expect(controlDriver.familyId).toBe('mongo');
        expect(controlDriver.db.databaseName).toBe(dbName);

        const planner = new MongoMigrationPlanner();
        const runner = new MongoMigrationRunner();
        const schema = contractToMongoSchemaIR(null);
        const result = planner.plan({
          contract: indexedContract,
          schema,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });
        if (result.kind !== 'success') throw new Error('Plan failed');

        const serialized = JSON.parse(serializeMongoOps(result.plan.operations));
        const runResult = await runner.execute({
          plan: {
            targetId: 'mongo',
            destination: { storageHash: indexedContract.storage.storageHash },
            operations: serialized,
          },
          driver: controlDriver,
          destinationContract: indexedContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });

        expect(runResult.ok).toBe(true);
      } finally {
        await controlDriver.close();
      }
    });
  });
});
