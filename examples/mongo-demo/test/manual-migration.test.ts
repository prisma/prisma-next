import { readFileSync } from 'node:fs';
import { createMongoRunnerDeps, extractDb } from '@prisma-next/adapter-mongo/control';
import { MongoDriverImpl } from '@prisma-next/driver-mongo';
import mongoControlDriver from '@prisma-next/driver-mongo/control';
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
          createMongoRunnerDeps(controlDriver, MongoDriverImpl.fromDb(extractDb(controlDriver))),
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

          destinationContract: {},
          policy: ALL_POLICY,
          frameworkComponents: [],
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
