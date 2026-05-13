/**
 * Mongo migration fan-out helper.
 *
 * Mirrors the shape of `describeSqlMigration` so test bodies read the
 * same way across families, but stays honest about the Mongo side:
 *
 *  - No `cols` parameter — Mongo's `field.string()` / `field.objectId()`
 *    builders are already canonical (no per-target column descriptor).
 *  - No typed `db` builder in `before`/`after` callbacks — Mongo has no
 *    contract-typed query DSL yet, so the callbacks receive the raw
 *    `MongoControlDriver` (`driver.db.collection(...).insertOne(...)`).
 *  - The fan-out is currently degenerate (one target — Mongo). The
 *    helper still produces a `${groupName} — mongo` describe so failures
 *    attribute consistently with the SQL fan-out, and so a future
 *    multi-Mongo fan-out (replica / sharded / atlas) can land without
 *    rewriting tests.
 *
 * ReplSet lifecycle is owned by the helper: one shared MongoMemoryReplSet
 * spins up in `beforeAll` and tears down in `afterAll` of each describe
 * block. Each `runMigration` call still gets a fresh database name via
 * `createMongoTestTarget`, so tests are isolated.
 */

import type { MongoControlDriver } from '@prisma-next/driver-mongo/control';
import mongoFamilyPack from '@prisma-next/family-mongo/pack';
import type { MigrationOperationPolicy } from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import { defineContract as baseDefineContract } from '@prisma-next/mongo-contract-ts/contract-builder';
import type { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import mongoTargetPack from '@prisma-next/target-mongo/pack';
import { timeouts } from '@prisma-next/test-utils/timeouts';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe } from 'vitest';
import { createMongoTestTarget } from './mongo-test-target';

// ---------------------------------------------------------------------------
// 1. defineContract — fills in family/target so tests don't repeat them
// ---------------------------------------------------------------------------

/**
 * Author a Mongo contract for tests. `family` and `target` are injected;
 * the caller only supplies `models` (and optionally `valueObjects`,
 * `roots`, `capabilities`, `extensionPacks`).
 *
 * Mongo has no contract-typed query DSL (cf. SQL's `db.User.insert(...)`),
 * so we don't carry the per-test `Models` generic through to the assertion
 * callback — the return type collapses to `MongoContract` for runtime use.
 */
function defineMongoFanoutContract<const Models extends Record<string, unknown>>(args: {
  models: Models;
}): MongoContract {
  const result = baseDefineContract({
    family: mongoFamilyPack,
    target: mongoTargetPack,
    // biome-ignore lint/suspicious/noExplicitAny: baseDefineContract's `models` constraint uses a private `AnyModelBuilder`. The contract-builder validates the shape at runtime; we keep the surface caller-friendly.
    models: args.models as any,
  });
  // `MongoContractResult<...>`'s `models` carries the literal-typed shape
  // produced by the builder. `MongoContract`'s `models` is the canonical
  // `Record<string, MongoModelDefinition>`. Both describe the same runtime
  // object; the structural cast crosses `exactOptionalPropertyTypes`.
  return result as unknown as MongoContract;
}

type DefineMongoContract = typeof defineMongoFanoutContract;

// ---------------------------------------------------------------------------
// 2. Run-migration shape
// ---------------------------------------------------------------------------

export interface MongoBeforeContext {
  readonly driver: MongoControlDriver;
}

export interface MongoAfterContext {
  readonly driver: MongoControlDriver;
  readonly schema: MongoSchemaIR;
  readonly operationsExecuted: number;
  readonly plannedOperationIds: readonly string[];
}

export interface RunMigrationOptions {
  readonly origin?: MongoContract;
  readonly destination: MongoContract;
  readonly policy?: MigrationOperationPolicy;
  readonly before?: (ctx: MongoBeforeContext) => Promise<void>;
  readonly after: (ctx: MongoAfterContext) => Promise<void>;
}

// ---------------------------------------------------------------------------
// 3. MongoFanoutContext — handed to the body callback
// ---------------------------------------------------------------------------

export interface MongoFanoutContext {
  readonly name: 'mongo';
  readonly defineContract: DefineMongoContract;
  runMigration(options: RunMigrationOptions): Promise<void>;
}

// ---------------------------------------------------------------------------
// 4. Orchestration — one ReplSet per describe block, fresh DB per test
// ---------------------------------------------------------------------------

async function runOneMigration(
  target: ReturnType<typeof createMongoTestTarget>,
  options: RunMigrationOptions,
): Promise<void> {
  const { driver, cleanup } = await target.setup();
  try {
    if (options.origin !== undefined) {
      await target.applyContract({
        driver,
        currentSchema: target.emptySchema,
        contract: options.origin,
        fromContract: null,
        policy: undefined,
        isInitial: true,
      });
      if (options.before !== undefined) {
        await options.before({ driver });
      }
    }

    const applyResult = await target.applyContract({
      driver,
      currentSchema: await target.introspect(driver),
      contract: options.destination,
      fromContract: options.origin ?? null,
      policy: options.policy,
      isInitial: false,
    });

    const fresh = await target.introspect(driver);
    const verify = target.verify({ contract: options.destination, schema: fresh });
    if (!verify.ok) {
      const issues = verify.schema.issues.map((i) => `  - [${i.kind}] ${i.message}`).join('\n');
      throw new Error(`Schema verification failed:\n${issues}`);
    }

    await options.after({
      driver,
      schema: target.filterUserSchema(fresh),
      operationsExecuted: applyResult.operationsExecuted,
      plannedOperationIds: applyResult.plannedOperationIds,
    });
  } finally {
    await cleanup();
  }
}

// ---------------------------------------------------------------------------
// 5. Public API — describeMongoMigration
// ---------------------------------------------------------------------------

export function describeMongoMigration(
  groupName: string,
  body: (ctx: MongoFanoutContext) => void,
): void {
  describe(`${groupName} — mongo`, { timeout: timeouts.spinUpMongoMemoryServer }, () => {
    let replSet: MongoMemoryReplSet | undefined;
    let target: ReturnType<typeof createMongoTestTarget> | undefined;

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({
        instanceOpts: [
          { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
        ],
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      target = createMongoTestTarget({ uri: replSet.getUri() });
    }, timeouts.spinUpMongoMemoryServer);

    afterAll(async () => {
      await replSet?.stop().catch(() => {});
    }, timeouts.spinUpMongoMemoryServer);

    const ctx: MongoFanoutContext = {
      name: 'mongo',
      defineContract: defineMongoFanoutContract,
      runMigration(options) {
        if (target === undefined) {
          throw new Error('describeMongoMigration: runMigration called before beforeAll completed');
        }
        return runOneMigration(target, options);
      },
    };
    body(ctx);
  });
}
