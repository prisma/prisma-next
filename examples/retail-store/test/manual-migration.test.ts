import { readFileSync } from 'node:fs';
import { createMongoRunnerDeps, extractDb } from '@prisma-next/adapter-mongo/control';
import { MongoDriverImpl } from '@prisma-next/driver-mongo';
import mongoControlDriver from '@prisma-next/driver-mongo/control';
import { createMongoFamilyInstance } from '@prisma-next/family-mongo/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import { deserializeMongoOps, MongoMigrationRunner } from '@prisma-next/target-mongo/control';
import { timeouts } from '@prisma-next/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { resolve } from 'pathe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import AddProductValidation from '../migrations/20260415_add-product-validation/migration';

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

function makeFamily(): ReturnType<typeof createMongoFamilyInstance> {
  // ControlStack arg is unused by the mongo factory; an empty object suffices for these examples.
  return createMongoFamilyInstance(
    {} as unknown as Parameters<typeof createMongoFamilyInstance>[0],
  );
}

const migrationDir = resolve(import.meta.dirname, '../migrations/20260415_add-product-validation');

describe(
  'hand-authored migration (20260415_add-product-validation)',
  { timeout: timeouts.spinUpMongoMemoryServer },
  () => {
    let replSet: MongoMemoryReplSet;
    let client: MongoClient;
    let db: Db;
    const dbName = 'manual_migration_test';

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
      try {
        await client?.close();
        await replSet?.stop();
      } catch {
        // ignore cleanup errors
      }
    }, timeouts.spinUpMongoMemoryServer);

    it('migration class can be imported and operations accessed directly', () => {
      const instance = new AddProductValidation();
      const ops = instance.operations;
      expect(ops).toHaveLength(2);
      expect(ops[0]!.id).toBe('collection.products.setValidation');
      expect(ops[1]!.id).toContain('index.products.create');
    });

    it('migration.json has expected structure', () => {
      const manifest = JSON.parse(readFileSync(resolve(migrationDir, 'migration.json'), 'utf-8'));

      expect(manifest.migrationId).toMatch(/^sha256:/);
      expect(manifest.kind).toBe('regular');
      expect(manifest.labels).toEqual(['add-product-validation']);
      expect(manifest.from).toMatch(/^sha256:/);
      expect(manifest.to).toMatch(/^sha256:/);
      expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('ops.json deserializes and applies against real MongoDB', async () => {
      await db.createCollection('products');

      const opsJson = readFileSync(resolve(migrationDir, 'ops.json'), 'utf-8');
      const ops = deserializeMongoOps(JSON.parse(opsJson));
      expect(ops).toHaveLength(2);

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
            destination: {
              storageHash:
                'sha256:e5cfc21670435e53a4af14a665d61d8ba716d5e2e67b63c1443affdcad86985d',
            },
            operations: JSON.parse(opsJson),
          },

          destinationContract: {} as unknown as MongoContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
          strictVerification: false,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.operationsExecuted).toBe(2);

        const info = await db.listCollections({ name: 'products' }).toArray();
        const options = (info[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
        expect(options['validator']).toBeDefined();

        const indexes = await db.collection('products').listIndexes().toArray();
        const categoryPriceIndex = indexes.find(
          (idx) =>
            idx['key'] &&
            (idx['key'] as Record<string, number>)['category'] === 1 &&
            (idx['key'] as Record<string, number>)['price'] === 1,
        );
        expect(categoryPriceIndex).toBeDefined();
      } finally {
        await controlDriver.close();
      }
    });
  },
);
