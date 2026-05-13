import { randomBytes } from 'node:crypto';
import {
  createMongoRunnerDeps,
  extractDb,
  introspectSchema,
} from '@prisma-next/adapter-mongo/control';
import { MongoDriverImpl } from '@prisma-next/driver-mongo';
import mongoControlDriver, { type MongoControlDriver } from '@prisma-next/driver-mongo/control';
import { createMongoFamilyInstance } from '@prisma-next/family-mongo/control';
import type { MigrationOperationPolicy } from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import type { MongoMigrationPlanOperation } from '@prisma-next/mongo-query-ast/control';
import { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import {
  MongoMigrationPlanner,
  MongoMigrationRunner,
  serializeMongoOps,
} from '@prisma-next/target-mongo/control';
import { verifyMongoSchema } from '@prisma-next/target-mongo/schema-verify';
import type { TestTargetAdapter } from '@prisma-next/test-utils/migration-harness';

const ALL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

const CONTROL_COLLECTIONS = new Set(['_prisma_migrations', '_prisma_marker']);

const emptySchema = new MongoSchemaIR([]);

export interface MongoTestTargetOptions {
  /**
   * Connection URI to a Mongo deployment. The adapter creates a fresh
   * database name per `setup()` call inside it, so the caller owns the
   * heavyweight ReplSet lifecycle (typically via vitest `beforeAll`).
   */
  readonly uri: string;
}

export function createMongoTestTarget(
  options: MongoTestTargetOptions,
): TestTargetAdapter<MongoContract, MongoSchemaIR, MongoControlDriver, MigrationOperationPolicy> {
  const familyInstance = createMongoFamilyInstance(
    {} as unknown as Parameters<typeof createMongoFamilyInstance>[0],
  );

  return {
    name: 'mongo',
    emptySchema,

    async setup() {
      const dbName = `mig_spike_${randomBytes(4).toString('hex')}`;
      const url = appendDatabase(options.uri, dbName);
      const driver = await mongoControlDriver.create(url);
      return {
        driver,
        async cleanup() {
          try {
            await driver.db.dropDatabase();
          } catch {
            /* ignore cleanup errors */
          }
          await driver.close();
        },
      };
    },

    async applyContract({ driver, contract, fromContract, policy, isInitial }) {
      const planner = new MongoMigrationPlanner();
      const effectivePolicy = isInitial ? ALL_POLICY : (policy ?? ALL_POLICY);

      const live = await introspectSchema(driver.db);
      const planResult = planner.plan({
        contract,
        schema: live,
        policy: effectivePolicy,
        fromContract,
        frameworkComponents: [],
      });
      if (planResult.kind !== 'success') {
        throw new Error(`Mongo planner failed (kind=${planResult.kind})`);
      }

      const ops = planResult.plan.operations as readonly MongoMigrationPlanOperation[];
      const serialized = JSON.parse(serializeMongoOps(ops));

      const runner = new MongoMigrationRunner(
        createMongoRunnerDeps(driver, MongoDriverImpl.fromDb(extractDb(driver)), familyInstance),
      );
      const runResult = await runner.execute({
        plan: {
          targetId: 'mongo',
          ...(fromContract !== null
            ? { origin: { storageHash: fromContract.storage.storageHash } }
            : {}),
          destination: { storageHash: contract.storage.storageHash },
          operations: serialized,
        },
        destinationContract: contract,
        policy: effectivePolicy,
        frameworkComponents: [],
      });
      if (!runResult.ok) {
        throw new Error(`Mongo runner failed: ${runResult.failure.summary}`);
      }

      return {
        plannedOperationIds: planResult.plan.operations.map((op) => op.id),
        operationsExecuted: runResult.value.operationsExecuted,
      };
    },

    async introspect(driver) {
      return introspectSchema(driver.db);
    },

    verify({ contract, schema, strict = false }) {
      return verifyMongoSchema({
        contract,
        schema,
        strict,
        frameworkComponents: [],
      });
    },

    filterUserSchema(schema) {
      const userCollections = schema.collections.filter((c) => !CONTROL_COLLECTIONS.has(c.name));
      return new MongoSchemaIR(userCollections);
    },
  };
}

function appendDatabase(uri: string, dbName: string): string {
  const u = new URL(uri);
  u.pathname = `/${dbName}`;
  return u.toString();
}
