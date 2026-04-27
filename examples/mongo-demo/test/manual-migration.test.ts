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
import AddPostsAuthorIndex from '../migrations/20260415_add-posts-author-index/migration';

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

function makeFamily(): ReturnType<typeof createMongoFamilyInstance> {
  // ControlStack arg is unused by the mongo factory; an empty object suffices for these examples.
  return createMongoFamilyInstance(
    {} as unknown as Parameters<typeof createMongoFamilyInstance>[0],
  );
}

const migrationDir = resolve(import.meta.dirname, '../migrations/20260415_add-posts-author-index');

describe(
  'hand-authored migration (20260415_add-posts-author-index)',
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
      const instance = new AddPostsAuthorIndex();
      const ops = instance.operations;
      expect(ops).toHaveLength(2);
      expect(ops[0]!.id).toBe('index.posts.create(authorId:1)');
      expect(ops[1]!.id).toBe('index.posts.create(createdAt:-1,authorId:1)');
    });

    it('migration.json has expected structure', () => {
      const manifest = JSON.parse(readFileSync(resolve(migrationDir, 'migration.json'), 'utf-8'));

      expect(manifest.migrationId).toMatch(/^sha256:/);
      expect(manifest.kind).toBe('regular');
      expect(manifest.labels).toEqual(['add-posts-author-index']);
      expect(manifest.from).toMatch(/^sha256:/);
      expect(manifest.to).toMatch(/^sha256:/);
      expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('ops.json deserializes and applies against real MongoDB', async () => {
      await db.createCollection('posts');

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
                'sha256:358522152ebe3ca9db3d573471c656778c1845f4cdd424caf06632352b9772fe',
            },
            operations: JSON.parse(opsJson),
          },
          // Synthetic-contract opt-out (paired with `strictVerification: false`):
          // this test feeds a hand-rolled ops JSON file to the runner; we have
          // no authored MongoContract to pass. Supply the minimum well-formed
          // shape `contractToMongoSchemaIR` reads (`storage.collections`) so
          // the verifier degrades to an empty-expected diff rather than
          // crashing in `contractToMongoSchemaIR` before the strict flag
          // is consulted.
          destinationContract: {
            storage: {
              storageHash:
                'sha256:358522152ebe3ca9db3d573471c656778c1845f4cdd424caf06632352b9772fe',
              collections: {},
            },
          } as unknown as MongoContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
          strictVerification: false,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.operationsExecuted).toBe(2);

        const indexes = await db.collection('posts').listIndexes().toArray();

        const authorIdIndex = indexes.find(
          (idx) =>
            idx['key'] &&
            (idx['key'] as Record<string, number>)['authorId'] === 1 &&
            !('createdAt' in (idx['key'] as Record<string, number>)),
        );
        expect(authorIdIndex).toBeDefined();

        const compoundIndex = indexes.find(
          (idx) =>
            idx['key'] &&
            (idx['key'] as Record<string, number>)['createdAt'] === -1 &&
            (idx['key'] as Record<string, number>)['authorId'] === 1,
        );
        expect(compoundIndex).toBeDefined();
      } finally {
        await controlDriver.close();
      }
    });
  },
);
