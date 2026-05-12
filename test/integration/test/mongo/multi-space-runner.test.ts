import { coreHash, profileHash } from '@prisma-next/contract/types';
import mongoControlDriver from '@prisma-next/driver-mongo/control';
import {
  createMongoFamilyInstance,
  mongoTargetDescriptor,
} from '@prisma-next/family-mongo/control';
import {
  APP_SPACE_ID,
  hasMigrations,
  type MultiSpaceRunnerPerSpaceOptions,
} from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import type { MongoMigrationPlanOperation } from '@prisma-next/mongo-query-ast/control';
import {
  contractToMongoSchemaIR,
  MongoMigrationPlanner,
  readAllMarkers,
  readMarker,
  serializeMongoOps,
} from '@prisma-next/target-mongo/control';
import { timeouts } from '@prisma-next/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

const EXT_SPACE = 'cipherstash';

type PerSpaceOptions = MultiSpaceRunnerPerSpaceOptions<'mongo', 'mongo'> & {
  readonly strictVerification?: boolean;
};

function makeFamily(): ReturnType<typeof createMongoFamilyInstance> {
  return createMongoFamilyInstance(
    {} as unknown as Parameters<typeof createMongoFamilyInstance>[0],
  );
}

function makeRunner() {
  if (!hasMigrations(mongoTargetDescriptor)) throw new Error('expected migrations');
  return mongoTargetDescriptor.migrations.createRunner(makeFamily());
}

function buildAppContract(): MongoContract {
  return {
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
      storageHash: coreHash('sha256:app-contract-multi-space'),
    },
    capabilities: {},
    extensionPacks: {},
    profileHash: profileHash('sha256:app-profile'),
    meta: {},
  };
}

function buildExtContract(): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: {},
    models: {},
    storage: {
      collections: {
        cipherstash_state: {
          indexes: [{ keys: [{ field: 'tenantId', direction: 1 as const }], unique: true }],
        },
      },
      storageHash: coreHash('sha256:ext-contract-multi-space'),
    },
    capabilities: {},
    extensionPacks: {},
    profileHash: profileHash('sha256:ext-profile'),
    meta: {},
  };
}

function planFor(contract: MongoContract, fromContract: MongoContract | null) {
  const planner = new MongoMigrationPlanner();
  const result = planner.plan({
    contract,
    schema: contractToMongoSchemaIR(fromContract),
    policy: ALL_POLICY,
    fromContract,
    frameworkComponents: [],
  });
  if (result.kind !== 'success') {
    throw new Error(`Plan failed: ${JSON.stringify(result.conflicts ?? [])}`);
  }
  const ops = result.plan.operations as readonly MongoMigrationPlanOperation[];
  return JSON.parse(serializeMongoOps(ops)) as readonly MongoMigrationPlanOperation[];
}

describe(
  'mongoTargetDescriptor.executeAcrossSpaces (multi-space)',
  { timeout: timeouts.spinUpMongoMemoryServer },
  () => {
    let replSet: MongoMemoryReplSet;
    let client: MongoClient;
    let db: Db;
    const dbName = 'mongo_multi_space_runner_test';

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

    afterAll(async () => {
      try {
        await client?.close();
        await replSet?.stop();
      } catch {
        // ignore cleanup errors
      }
    }, timeouts.spinUpMongoMemoryServer);

    beforeEach(async () => {
      await db.dropDatabase();
    });

    it('runs both spaces in caller order with verify non-strict (TC-7)', async () => {
      const runner = makeRunner();
      const appContract = buildAppContract();
      const extContract = buildExtContract();
      const appOps = planFor(appContract, null);
      const extOps = planFor(extContract, null);

      const driver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const perSpaceOptions: readonly PerSpaceOptions[] = [
          {
            space: EXT_SPACE,
            plan: {
              targetId: 'mongo',
              spaceId: EXT_SPACE,
              destination: { storageHash: extContract.storage.storageHash },
              operations: extOps,
            },
            driver,
            destinationContract: extContract,
            policy: ALL_POLICY,
            frameworkComponents: [],
            strictVerification: false,
          },
          {
            space: APP_SPACE_ID,
            plan: {
              targetId: 'mongo',
              spaceId: APP_SPACE_ID,
              destination: { storageHash: appContract.storage.storageHash },
              operations: appOps,
            },
            driver,
            destinationContract: appContract,
            policy: ALL_POLICY,
            frameworkComponents: [],
            strictVerification: false,
          },
        ];

        const result = await runner.executeAcrossSpaces({ driver, perSpaceOptions });

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        expect(result.value.perSpaceResults.map((r) => r.space)).toEqual([EXT_SPACE, APP_SPACE_ID]);

        const markers = await readAllMarkers(db);
        expect(markers.size).toBe(2);
        expect(markers.get(APP_SPACE_ID)?.storageHash).toBe(appContract.storage.storageHash);
        expect(markers.get(EXT_SPACE)?.storageHash).toBe(extContract.storage.storageHash);
      } finally {
        await driver.close();
      }
    });

    it('degenerate single-space invocation succeeds', async () => {
      const runner = makeRunner();
      const appContract = buildAppContract();
      const appOps = planFor(appContract, null);

      const driver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const result = await runner.executeAcrossSpaces({
          driver,
          perSpaceOptions: [
            {
              space: APP_SPACE_ID,
              plan: {
                targetId: 'mongo',
                spaceId: APP_SPACE_ID,
                destination: { storageHash: appContract.storage.storageHash },
                operations: appOps,
              },
              driver,
              destinationContract: appContract,
              policy: ALL_POLICY,
              frameworkComponents: [],
            },
          ],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        expect(result.value.perSpaceResults).toHaveLength(1);
        expect(result.value.perSpaceResults[0]?.space).toBe(APP_SPACE_ID);
      } finally {
        await driver.close();
      }
    });

    it('empty perSpaceOptions returns ok with no results', async () => {
      const runner = makeRunner();
      const driver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const result = await runner.executeAcrossSpaces({ driver, perSpaceOptions: [] });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        expect(result.value.perSpaceResults).toEqual([]);
      } finally {
        await driver.close();
      }
    });

    it('mid-run failure surfaces failingSpace and leaves earlier markers advanced (TC-8); resume retries failed space and skips already-at-head spaces (TC-9)', async () => {
      const runner = makeRunner();
      const appContract = buildAppContract();
      const extContract = buildExtContract();
      const extOps = planFor(extContract, null);
      const appOps = planFor(appContract, null);

      const driver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        // TC-8: ext (default strict=true verify) sees only its own collection,
        // passes. App with strict=true sees the ext collection as an extra and
        // fails. Failure surfaces failingSpace='app'; ext marker remains
        // advanced; app marker is never written.
        const failingPerSpaceOptions: readonly PerSpaceOptions[] = [
          {
            space: EXT_SPACE,
            plan: {
              targetId: 'mongo',
              spaceId: EXT_SPACE,
              destination: { storageHash: extContract.storage.storageHash },
              operations: extOps,
            },
            driver,
            destinationContract: extContract,
            policy: ALL_POLICY,
            frameworkComponents: [],
          },
          {
            space: APP_SPACE_ID,
            plan: {
              targetId: 'mongo',
              spaceId: APP_SPACE_ID,
              destination: { storageHash: appContract.storage.storageHash },
              operations: appOps,
            },
            driver,
            destinationContract: appContract,
            policy: ALL_POLICY,
            frameworkComponents: [],
          },
        ];

        const failingResult = await runner.executeAcrossSpaces({
          driver,
          perSpaceOptions: failingPerSpaceOptions,
        });

        expect(failingResult.ok).toBe(false);
        if (failingResult.ok) throw new Error('unreachable');
        expect(failingResult.failure.failingSpace).toBe(APP_SPACE_ID);
        expect(failingResult.failure.code).toBe('SCHEMA_VERIFY_FAILED');

        const extMarkerAfterFail = await readMarker(db, EXT_SPACE);
        expect(extMarkerAfterFail?.storageHash).toBe(extContract.storage.storageHash);
        const appMarkerAfterFail = await readMarker(db, APP_SPACE_ID);
        expect(appMarkerAfterFail).toBeNull();

        // TC-9: re-run with non-strict app verify so the apply succeeds.
        // ext is already at head, so the runner's no-op-skip path leaves
        // its marker untouched (writes neither marker nor ledger). App
        // applies its ops, advances its marker.
        const resumePerSpaceOptions: readonly PerSpaceOptions[] = [
          {
            space: EXT_SPACE,
            plan: {
              targetId: 'mongo',
              spaceId: EXT_SPACE,
              destination: { storageHash: extContract.storage.storageHash },
              operations: extOps,
            },
            driver,
            destinationContract: extContract,
            policy: ALL_POLICY,
            frameworkComponents: [],
          },
          {
            space: APP_SPACE_ID,
            plan: {
              targetId: 'mongo',
              spaceId: APP_SPACE_ID,
              destination: { storageHash: appContract.storage.storageHash },
              operations: appOps,
            },
            driver,
            destinationContract: appContract,
            policy: ALL_POLICY,
            frameworkComponents: [],
            strictVerification: false,
          },
        ];

        const resumeResult = await runner.executeAcrossSpaces({
          driver,
          perSpaceOptions: resumePerSpaceOptions,
        });

        expect(resumeResult.ok).toBe(true);
        if (!resumeResult.ok) throw new Error('unreachable');
        expect(resumeResult.value.perSpaceResults.map((r) => r.space)).toEqual([
          EXT_SPACE,
          APP_SPACE_ID,
        ]);

        const markers = await readAllMarkers(db);
        expect(markers.size).toBe(2);
        expect(markers.get(APP_SPACE_ID)?.storageHash).toBe(appContract.storage.storageHash);
        expect(markers.get(EXT_SPACE)?.storageHash).toBe(extContract.storage.storageHash);
      } finally {
        await driver.close();
      }
    });
  },
);
