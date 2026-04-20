import { createMongoControlDriver } from '@prisma-next/adapter-mongo/control';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import {
  createMongoFamilyInstance,
  mongoFamilyDescriptor,
  mongoTargetDescriptor,
} from '@prisma-next/family-mongo/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import { initMarker } from '@prisma-next/target-mongo/control';
import { timeouts } from '@prisma-next/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const baseContract: MongoContract = {
  target: 'mongo',
  targetFamily: 'mongo',
  roots: { users: 'User' },
  models: {
    User: {
      fields: {
        _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
        email: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
      },
      relations: {},
      storage: { collection: 'users' },
    },
  },
  storage: {
    collections: {
      users: {
        indexes: [{ keys: [{ field: 'email', direction: 1 as const }], unique: true }],
      },
    },
    storageHash: coreHash('sha256:verify-test'),
  },
  capabilities: {},
  extensionPacks: {},
  profileHash: profileHash('sha256:verify-test'),
  meta: {},
};

function createInstance() {
  const stack = createControlStack({
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
  });
  return createMongoFamilyInstance(stack);
}

describe(
  'db verify + db sign for Mongo (end-to-end)',
  { timeout: timeouts.spinUpMongoMemoryServer },
  () => {
    let replSet: MongoMemoryReplSet;
    let client: MongoClient;
    let db: Db;
    const dbName = 'verify_sign_e2e_test';

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({
        instanceOpts: [
          { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
        ],
        replSet: { count: 1 },
      });
      client = new MongoClient(replSet.getUri());
      await client.connect();
      db = client.db(dbName);
    }, timeouts.spinUpMongoMemoryServer);

    afterAll(async () => {
      await client?.close();
      await replSet?.stop();
    }, timeouts.spinUpMongoMemoryServer);

    beforeEach(async () => {
      await db.dropDatabase();
    }, timeouts.databaseOperation);

    function makeDriver() {
      return createMongoControlDriver(db, client);
    }

    describe('verify (marker-only)', () => {
      it('returns PN-RUN-3001 when no marker exists', async () => {
        const instance = createInstance();
        const result = await instance.verify({
          driver: makeDriver(),
          contract: baseContract,
          expectedTargetId: 'mongo',
          contractPath: '/test/contract.json',
        });

        expect(result.ok).toBe(false);
        expect(result.code).toBe('PN-RUN-3001');
        expect(result.summary).toContain('missing');
      });

      it('returns ok when marker matches', async () => {
        await initMarker(db, {
          storageHash: baseContract.storage.storageHash,
          profileHash: baseContract.profileHash,
        });

        const instance = createInstance();
        const result = await instance.verify({
          driver: makeDriver(),
          contract: baseContract,
          expectedTargetId: 'mongo',
          contractPath: '/test/contract.json',
        });

        expect(result.ok).toBe(true);
        expect(result.summary).toContain('matches');
      });

      it('returns PN-RUN-3002 when storage hash differs', async () => {
        await initMarker(db, {
          storageHash: coreHash('sha256:old-hash'),
          profileHash: baseContract.profileHash,
        });

        const instance = createInstance();
        const result = await instance.verify({
          driver: makeDriver(),
          contract: baseContract,
          expectedTargetId: 'mongo',
          contractPath: '/test/contract.json',
        });

        expect(result.ok).toBe(false);
        expect(result.code).toBe('PN-RUN-3002');
      });

      it('returns PN-RUN-3002 when profile hash differs', async () => {
        await initMarker(db, {
          storageHash: baseContract.storage.storageHash,
          profileHash: profileHash('sha256:old-profile'),
        });

        const instance = createInstance();
        const result = await instance.verify({
          driver: makeDriver(),
          contract: baseContract,
          expectedTargetId: 'mongo',
          contractPath: '/test/contract.json',
        });

        expect(result.ok).toBe(false);
        expect(result.code).toBe('PN-RUN-3002');
      });
    });

    describe('schemaVerify', () => {
      it('returns ok when schema matches contract', async () => {
        await db.createCollection('users');
        await db.collection('users').createIndex({ email: 1 }, { unique: true });

        const instance = createInstance();
        const result = await instance.schemaVerify({
          driver: makeDriver(),
          contract: baseContract,
          strict: false,
          contractPath: '/test/contract.json',
          frameworkComponents: [],
        });

        expect(result.ok).toBe(true);
        expect(result.schema.counts.fail).toBe(0);
      });

      it('fails when expected index is missing', async () => {
        await db.createCollection('users');

        const instance = createInstance();
        const result = await instance.schemaVerify({
          driver: makeDriver(),
          contract: baseContract,
          strict: false,
          contractPath: '/test/contract.json',
          frameworkComponents: [],
        });

        expect(result.ok).toBe(false);
        expect(result.schema.counts.fail).toBeGreaterThan(0);
        expect(result.schema.issues.some((i) => i.kind === 'index_mismatch')).toBe(true);
      });

      it('warns on extra index in non-strict mode', async () => {
        await db.createCollection('users');
        await db.collection('users').createIndex({ email: 1 }, { unique: true });
        await db.collection('users').createIndex({ createdAt: -1 });

        const instance = createInstance();
        const result = await instance.schemaVerify({
          driver: makeDriver(),
          contract: baseContract,
          strict: false,
          contractPath: '/test/contract.json',
          frameworkComponents: [],
        });

        expect(result.ok).toBe(true);
        expect(result.schema.counts.warn).toBeGreaterThan(0);
      });

      it('fails on extra index in strict mode', async () => {
        await db.createCollection('users');
        await db.collection('users').createIndex({ email: 1 }, { unique: true });
        await db.collection('users').createIndex({ createdAt: -1 });

        const instance = createInstance();
        const result = await instance.schemaVerify({
          driver: makeDriver(),
          contract: baseContract,
          strict: true,
          contractPath: '/test/contract.json',
          frameworkComponents: [],
        });

        expect(result.ok).toBe(false);
        expect(result.schema.counts.fail).toBeGreaterThan(0);
      });

      it('fails when expected collection is missing', async () => {
        const instance = createInstance();
        const result = await instance.schemaVerify({
          driver: makeDriver(),
          contract: baseContract,
          strict: false,
          contractPath: '/test/contract.json',
          frameworkComponents: [],
        });

        expect(result.ok).toBe(false);
        expect(result.schema.issues.some((i) => i.kind === 'missing_table')).toBe(true);
      });
    });

    describe('sign', () => {
      it('creates marker on fresh database', async () => {
        const instance = createInstance();
        const result = await instance.sign({
          driver: makeDriver(),
          contract: baseContract,
          contractPath: '/test/contract.json',
        });

        expect(result.ok).toBe(true);
        expect(result.marker.created).toBe(true);
        expect(result.marker.updated).toBe(false);
        expect(result.contract.storageHash).toBe(baseContract.storage.storageHash);
      });

      it('re-signing with same contract is idempotent', async () => {
        const instance = createInstance();

        await instance.sign({
          driver: makeDriver(),
          contract: baseContract,
          contractPath: '/test/contract.json',
        });

        const result = await instance.sign({
          driver: makeDriver(),
          contract: baseContract,
          contractPath: '/test/contract.json',
        });

        expect(result.ok).toBe(true);
        expect(result.marker.created).toBe(false);
        expect(result.marker.updated).toBe(false);
        expect(result.summary).toContain('already signed');
      });

      it('updates marker when contract changes', async () => {
        const instance = createInstance();

        await instance.sign({
          driver: makeDriver(),
          contract: baseContract,
          contractPath: '/test/contract.json',
        });

        const updatedContract: MongoContract = {
          ...baseContract,
          storage: {
            ...baseContract.storage,
            storageHash: coreHash('sha256:updated-contract'),
          },
        };

        const result = await instance.sign({
          driver: makeDriver(),
          contract: updatedContract,
          contractPath: '/test/contract.json',
        });

        expect(result.ok).toBe(true);
        expect(result.marker.updated).toBe(true);
        expect(result.marker.previous?.storageHash).toBe(baseContract.storage.storageHash);
      });
    });
  },
);
