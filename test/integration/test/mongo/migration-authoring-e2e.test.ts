import { createMongoRunnerDeps, extractDb } from '@prisma-next/adapter-mongo/control';
import { MongoDriverImpl } from '@prisma-next/driver-mongo';
import mongoControlDriver from '@prisma-next/driver-mongo/control';
import { createMongoFamilyInstance } from '@prisma-next/family-mongo/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import type { AnyMongoMigrationOperation } from '@prisma-next/mongo-query-ast/control';
import {
  deserializeMongoOps,
  MongoMigrationRunner,
  serializeMongoOps,
} from '@prisma-next/target-mongo/control';
import {
  createCollection,
  createIndex,
  dropCollection,
  dropIndex,
  setValidation,
  validatedCollection,
} from '@prisma-next/target-mongo/migration';
import { timeouts } from '@prisma-next/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] as const,
};

function makeFamily(): ReturnType<typeof createMongoFamilyInstance> {
  // ControlStack arg is unused by the mongo factory; an empty object suffices for these integration tests.
  return createMongoFamilyInstance(
    {} as unknown as Parameters<typeof createMongoFamilyInstance>[0],
  );
}

describe(
  'Migration authoring round-trip (factory → serialize → deserialize → runner → DB)',
  { timeout: timeouts.spinUpMongoMemoryServer },
  () => {
    let replSet: MongoMemoryReplSet;
    let client: MongoClient;
    let db: Db;
    const dbName = 'authoring_e2e_test';

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({
        instanceOpts: [
          { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
        ],
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      client = new MongoClient(replSet.getUri());
      await client.connect();
      db = client.db(dbName);
    }, timeouts.spinUpMongoMemoryServer);

    beforeEach(async () => {
      await db.dropDatabase();
    });

    afterAll(async () => {
      await Promise.allSettled([
        client?.close() ?? Promise.resolve(),
        replSet?.stop() ?? Promise.resolve(),
      ]);
    }, timeouts.spinUpMongoMemoryServer);

    async function runOps(ops: readonly AnyMongoMigrationOperation[]): Promise<{
      operationsPlanned: number;
      operationsExecuted: number;
    }> {
      const serialized = JSON.parse(serializeMongoOps(ops));
      const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const runner = new MongoMigrationRunner(
          createMongoRunnerDeps(
            controlDriver,
            MongoDriverImpl.fromDb(extractDb(controlDriver)),
            makeFamily(),
          ),
        );
        const result = await runner.execute({
          plan: {
            targetId: 'mongo',
            destination: { storageHash: 'authoring-test' },
            operations: serialized,
          },

          destinationContract: {} as unknown as MongoContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
          strictVerification: false,
        });
        if (!result.ok) throw new Error(`Runner failed: ${result.failure.summary}`);
        return result.value;
      } finally {
        await controlDriver.close();
      }
    }

    describe('createCollection', () => {
      it('creates the collection in MongoDB', async () => {
        const ops = [createCollection('users')];
        const result = await runOps(ops);
        expect(result.operationsExecuted).toBe(1);

        const collections = await db.listCollections({ name: 'users' }).toArray();
        expect(collections).toHaveLength(1);
      });

      it('creates a collection with JSON schema validation', async () => {
        const ops = [
          createCollection('users', {
            validator: { $jsonSchema: { required: ['email'] } },
            validationLevel: 'strict',
            validationAction: 'error',
          }),
        ];
        await runOps(ops);

        const info = await db.listCollections({ name: 'users' }).toArray();
        const options = (info[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
        expect(options['validator']).toEqual({ $jsonSchema: { required: ['email'] } });
      });
    });

    describe('createIndex', () => {
      it('creates an index on the collection', async () => {
        await db.createCollection('users');
        const ops = [createIndex('users', [{ field: 'email', direction: 1 as const }])];
        const result = await runOps(ops);
        expect(result.operationsExecuted).toBe(1);

        const indexes = await db.collection('users').listIndexes().toArray();
        const emailIndex = indexes.find(
          (idx) => idx['key'] && (idx['key'] as Record<string, number>)['email'] === 1,
        );
        expect(emailIndex).toBeDefined();
      });

      it('creates a unique index', async () => {
        await db.createCollection('users');
        const ops = [
          createIndex('users', [{ field: 'email', direction: 1 as const }], { unique: true }),
        ];
        await runOps(ops);

        const indexes = await db.collection('users').listIndexes().toArray();
        const emailIndex = indexes.find(
          (idx) => idx['key'] && (idx['key'] as Record<string, number>)['email'] === 1,
        );
        expect(emailIndex).toBeDefined();
        expect(emailIndex!['unique']).toBe(true);
      });
    });

    describe('dropIndex', () => {
      it('drops an existing index', async () => {
        await db.createCollection('users');
        await db.collection('users').createIndex({ email: 1 }, { name: 'email_1' });

        const ops = [dropIndex('users', [{ field: 'email', direction: 1 as const }])];
        const result = await runOps(ops);
        expect(result.operationsExecuted).toBe(1);

        const indexes = await db.collection('users').listIndexes().toArray();
        const emailIndex = indexes.find(
          (idx) => idx['key'] && (idx['key'] as Record<string, number>)['email'] === 1,
        );
        expect(emailIndex).toBeUndefined();
      });
    });

    describe('dropCollection', () => {
      it('drops an existing collection', async () => {
        await db.createCollection('users');
        const ops = [dropCollection('users')];
        const result = await runOps(ops);
        expect(result.operationsExecuted).toBe(1);

        const collections = await db.listCollections({ name: 'users' }).toArray();
        expect(collections).toHaveLength(0);
      });
    });

    describe('setValidation', () => {
      it('modifies collection validation', async () => {
        await db.createCollection('users');
        const ops = [
          setValidation('users', { required: ['email', 'name'] }, { validationLevel: 'strict' }),
        ];
        const result = await runOps(ops);
        expect(result.operationsExecuted).toBe(1);

        const info = await db.listCollections({ name: 'users' }).toArray();
        const options = (info[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
        expect(options['validator']).toEqual({
          $jsonSchema: { required: ['email', 'name'] },
        });
      });
    });

    describe('round-trip serialization', () => {
      it('factory → JSON.stringify → deserializeMongoOps produces equivalent ops', () => {
        const original = [
          createCollection('users', {
            validator: { $jsonSchema: { required: ['email'] } },
            validationLevel: 'strict',
          }),
          createIndex('users', [{ field: 'email', direction: 1 as const }], { unique: true }),
          dropIndex('users', [{ field: 'email', direction: 1 as const }]),
          setValidation('users', { required: ['email', 'name'] }),
          dropCollection('users'),
        ];

        const json = JSON.stringify(original);
        const deserialized = deserializeMongoOps(JSON.parse(json));

        expect(deserialized).toHaveLength(5);
        for (let i = 0; i < original.length; i++) {
          expect(deserialized[i]!.id).toBe(original[i]!.id);
          expect(deserialized[i]!.label).toBe(original[i]!.label);
          expect(deserialized[i]!.operationClass).toBe(original[i]!.operationClass);
        }
      });

      it('deserialized ops execute successfully against the DB', async () => {
        const original = [
          createCollection('users'),
          createIndex('users', [{ field: 'email', direction: 1 as const }], { unique: true }),
        ];

        const json = JSON.stringify(original);
        const deserialized = deserializeMongoOps(JSON.parse(json));

        const result = await runOps(deserialized);
        expect(result.operationsExecuted).toBe(2);

        const collections = await db.listCollections({ name: 'users' }).toArray();
        expect(collections).toHaveLength(1);

        const indexes = await db.collection('users').listIndexes().toArray();
        const emailIndex = indexes.find(
          (idx) => idx['key'] && (idx['key'] as Record<string, number>)['email'] === 1,
        );
        expect(emailIndex).toBeDefined();
        expect(emailIndex!['unique']).toBe(true);
      });
    });

    describe('validatedCollection', () => {
      it('creates collection with schema validation and indexes', async () => {
        const ops = validatedCollection('users', { required: ['email', 'name'] }, [
          { keys: [{ field: 'email', direction: 1 }], unique: true },
          { keys: [{ field: 'name', direction: 1 }] },
        ]);
        const result = await runOps(ops);
        expect(result.operationsExecuted).toBe(3);

        const info = await db.listCollections({ name: 'users' }).toArray();
        expect(info).toHaveLength(1);
        const options = (info[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
        expect(options['validator']).toEqual({
          $jsonSchema: { required: ['email', 'name'] },
        });

        const indexes = await db.collection('users').listIndexes().toArray();
        const emailIndex = indexes.find(
          (idx) => idx['key'] && (idx['key'] as Record<string, number>)['email'] === 1,
        );
        expect(emailIndex).toBeDefined();
        expect(emailIndex!['unique']).toBe(true);

        const nameIndex = indexes.find(
          (idx) => idx['key'] && (idx['key'] as Record<string, number>)['name'] === 1,
        );
        expect(nameIndex).toBeDefined();
      });

      it('round-trips through serialization and runs against the DB', async () => {
        const ops = validatedCollection('posts', { required: ['title'] }, [
          { keys: [{ field: 'title', direction: 1 }] },
        ]);

        const json = JSON.stringify(ops);
        const deserialized = deserializeMongoOps(JSON.parse(json));
        const result = await runOps(deserialized);
        expect(result.operationsExecuted).toBe(2);

        const collections = await db.listCollections({ name: 'posts' }).toArray();
        expect(collections).toHaveLength(1);
      });
    });

    describe('multi-step migration lifecycle', () => {
      it('applies a full create → modify → drop lifecycle', async () => {
        const step1 = [
          createCollection('users', {
            validator: { $jsonSchema: { required: ['email'] } },
            validationLevel: 'strict',
          }),
          createIndex('users', [{ field: 'email', direction: 1 as const }], { unique: true }),
        ];
        await runOps(step1);

        let collections = await db.listCollections({ name: 'users' }).toArray();
        expect(collections).toHaveLength(1);
        const indexes = await db.collection('users').listIndexes().toArray();
        expect(indexes.some((idx) => (idx['key'] as Record<string, number>)?.['email'] === 1)).toBe(
          true,
        );

        const step2 = [setValidation('users', { required: ['email', 'name'] })];

        const serialized2 = JSON.parse(serializeMongoOps(step2));
        const controlDriver2 = await mongoControlDriver.create(replSet.getUri(dbName));
        try {
          const runner = new MongoMigrationRunner(
            createMongoRunnerDeps(
              controlDriver2,
              MongoDriverImpl.fromDb(extractDb(controlDriver2)),
              makeFamily(),
            ),
          );
          const result2 = await runner.execute({
            plan: {
              targetId: 'mongo',
              origin: { storageHash: 'authoring-test' },
              destination: { storageHash: 'authoring-test-v2' },
              operations: serialized2,
            },

            destinationContract: {} as unknown as MongoContract,
            policy: ALL_POLICY,
            frameworkComponents: [],
            strictVerification: false,
          });
          expect(result2.ok).toBe(true);
        } finally {
          await controlDriver2.close();
        }

        const info = await db.listCollections({ name: 'users' }).toArray();
        const options = (info[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
        expect(options['validator']).toEqual({
          $jsonSchema: { required: ['email', 'name'] },
        });

        const step3 = [
          dropIndex('users', [{ field: 'email', direction: 1 as const }]),
          dropCollection('users'),
        ];

        const serialized3 = JSON.parse(serializeMongoOps(step3));
        const controlDriver3 = await mongoControlDriver.create(replSet.getUri(dbName));
        try {
          const runner = new MongoMigrationRunner(
            createMongoRunnerDeps(
              controlDriver3,
              MongoDriverImpl.fromDb(extractDb(controlDriver3)),
              makeFamily(),
            ),
          );
          const result3 = await runner.execute({
            plan: {
              targetId: 'mongo',
              origin: { storageHash: 'authoring-test-v2' },
              destination: { storageHash: 'authoring-test-v3' },
              operations: serialized3,
            },

            destinationContract: {} as unknown as MongoContract,
            policy: ALL_POLICY,
            frameworkComponents: [],
            strictVerification: false,
          });
          expect(result3.ok).toBe(true);
        } finally {
          await controlDriver3.close();
        }

        collections = await db.listCollections({ name: 'users' }).toArray();
        expect(collections).toHaveLength(0);
      });
    });
  },
);
