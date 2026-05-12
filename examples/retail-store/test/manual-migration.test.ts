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
import BackfillProductStatus from '../migrations/app/20260512T2020_backfill_product_status/migration';

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] as const,
};

function makeFamily(): ReturnType<typeof createMongoFamilyInstance> {
  // ControlStack arg is unused by the mongo factory; an empty object suffices for these examples.
  return createMongoFamilyInstance(
    {} as unknown as Parameters<typeof createMongoFamilyInstance>[0],
  );
}

const migrationDir = resolve(
  import.meta.dirname,
  '../migrations/app/20260512T2020_backfill_product_status',
);

describe(
  'hand-authored migration (backfill-product-status)',
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
      const instance = new BackfillProductStatus();
      const ops = instance.operations;
      expect(ops).toHaveLength(1);
      expect(ops[0]!.id).toBe('data_transform.backfill-product-status');
    });

    it('migration.json has expected structure', () => {
      const manifest = JSON.parse(readFileSync(resolve(migrationDir, 'migration.json'), 'utf-8'));

      expect(manifest.migrationHash).toMatch(/^sha256:/);
      expect(manifest.labels).toEqual(['backfill-product-status']);
      expect(manifest.from).toMatch(/^sha256:/);
      expect(manifest.to).toMatch(/^sha256:/);
      expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('ops.json deserializes and applies against real MongoDB, backfilling missing status', async () => {
      // Seed two pre-existing products that pre-date the `status` field;
      // the data transform should observe both and update them.
      await db.collection('products').insertMany([
        { name: 'Pre-existing widget A', brand: 'Acme', price: { amount: 10, currency: 'USD' } },
        { name: 'Pre-existing widget B', brand: 'Acme', price: { amount: 20, currency: 'USD' } },
      ]);

      const opsJson = readFileSync(resolve(migrationDir, 'ops.json'), 'utf-8');
      const ops = deserializeMongoOps(JSON.parse(opsJson));
      expect(ops).toHaveLength(1);

      const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const runner = new MongoMigrationRunner(
          createMongoRunnerDeps(
            controlDriver,
            MongoDriverImpl.fromDb(extractDb(controlDriver)),
            makeFamily(),
          ),
        );
        // Synthetic-contract opt-out (paired with `strictVerification: false`):
        // this test isolates migration 3's apply mechanics against a real
        // driver, without first running migrations 1 + 2. We supply the
        // minimum well-formed shape the verifier reads (`storage.collections`)
        // so it degrades to an empty-expected diff rather than failing on
        // peer collections (carts, orders, …) that the chain prerequisites
        // would normally create.
        const STORAGE_HASH =
          'sha256:50134e16bc78b848f51f2dc00025eb3b4bbcbee55f402f7d9b71608a1b2d0c65';
        const result = await runner.execute({
          plan: {
            targetId: 'mongo',
            destination: { storageHash: STORAGE_HASH },
            operations: JSON.parse(opsJson),
          },
          destinationContract: {
            storage: { storageHash: STORAGE_HASH, collections: {} },
          } as unknown as MongoContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
          strictVerification: false,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.operationsExecuted).toBe(1);

        const products = await db.collection('products').find({}).toArray();
        expect(products).toHaveLength(2);
        for (const p of products) {
          expect(p['status']).toBe('active');
        }
      } finally {
        await controlDriver.close();
      }
    });
  },
);
