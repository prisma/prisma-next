import { readFileSync } from 'node:fs';
import { deserializeMongoOps, MongoMigrationRunner } from '@prisma-next/adapter-mongo/control';
import mongoControlDriver from '@prisma-next/driver-mongo/control';
import { timeouts } from '@prisma-next/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { resolve } from 'pathe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

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

    it('migration.ts can be imported and plan() called directly', async () => {
      const mod = await import('../migrations/20260415_add-product-validation/migration.ts');
      const instance = new mod.default();

      const ops = instance.plan();
      expect(ops).toHaveLength(2);
      expect(ops[0].id).toBe('collMod.products');
      expect(ops[1].id).toContain('index.products.create');
    });

    it('migration.ts describe() returns correct metadata', async () => {
      const mod = await import('../migrations/20260415_add-product-validation/migration.ts');
      const instance = new mod.default();
      const meta = instance.describe();
      expect(meta.labels).toEqual(['add-product-validation']);
    });

    it('ops.json deserializes and applies against real MongoDB', async () => {
      await db.createCollection('products');

      const opsJson = readFileSync(resolve(migrationDir, 'ops.json'), 'utf-8');
      const ops = deserializeMongoOps(JSON.parse(opsJson));
      expect(ops).toHaveLength(2);

      const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const runner = new MongoMigrationRunner();
        const result = await runner.execute({
          plan: {
            targetId: 'mongo',
            destination: {
              storageHash:
                'sha256:e5cfc21670435e53a4af14a665d61d8ba716d5e2e67b63c1443affdcad86985d',
            },
            operations: JSON.parse(opsJson),
          },
          driver: controlDriver,
          destinationContract: {},
          policy: ALL_POLICY,
          frameworkComponents: [],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.operationsExecuted).toBe(2);

        const info = await db.listCollections({ name: 'products' }).toArray();
        const options = info[0]!['options'] as Record<string, unknown>;
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

    it('migration.json exists and has expected structure', () => {
      const manifestJson = readFileSync(resolve(migrationDir, 'migration.json'), 'utf-8');
      const manifest = JSON.parse(manifestJson);

      expect(manifest.migrationId).toBeNull();
      expect(manifest.kind).toBe('regular');
      expect(manifest.labels).toEqual(['add-product-validation']);
      expect(manifest.from).toMatch(/^sha256:/);
      expect(manifest.to).toMatch(/^sha256:/);
      expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  },
);
