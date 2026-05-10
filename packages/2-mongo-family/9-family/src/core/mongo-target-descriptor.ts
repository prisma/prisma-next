import { createMongoRunnerDeps, extractDb } from '@prisma-next/adapter-mongo/control';
import type { Contract } from '@prisma-next/contract/types';
import { MongoDriverImpl } from '@prisma-next/driver-mongo';
import type {
  MigratableTargetDescriptor,
  MigrationRunner,
  MultiSpaceCapableRunner,
  MultiSpaceRunnerFailure,
  MultiSpaceRunnerResult,
} from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import {
  contractToMongoSchemaIR,
  MongoMigrationPlanner,
  MongoMigrationRunner,
  type MongoRunnerDependencies,
} from '@prisma-next/target-mongo/control';
import mongoTargetDescriptorMeta from '@prisma-next/target-mongo/pack';
import { notOk, ok } from '@prisma-next/utils/result';
import type { MongoControlFamilyInstance } from './control-instance';

/**
 * `migration.ts` default-exports a `Migration` subclass whose `operations`
 * getter returns the ordered list of operations and whose `describe()`
 * returns the manifest identity metadata. `MongoMigrationPlanner.plan()`
 * returns a `MigrationPlanWithAuthoringSurface` that knows how to render
 * itself back to such a file; `MongoMigrationPlanner.emptyMigration()`
 * returns the same shape for `migration new`. Users run the scaffolded
 * `migration.ts` directly (via `node migration.ts`) to self-emit
 * `ops.json` and attest the `migrationHash`.
 */
export const mongoTargetDescriptor: MigratableTargetDescriptor<
  'mongo',
  'mongo',
  MongoControlFamilyInstance
> = {
  ...mongoTargetDescriptorMeta,
  migrations: {
    createPlanner(_family: MongoControlFamilyInstance) {
      return new MongoMigrationPlanner();
    },
    createRunner(family: MongoControlFamilyInstance) {
      // Deps are bound to the first driver passed to execute() and cached for
      // subsequent calls. Callers must not change the driver between calls.
      let cachedDeps: MongoRunnerDependencies | undefined;
      const runner: MigrationRunner<'mongo', 'mongo'> & MultiSpaceCapableRunner<'mongo', 'mongo'> =
        {
          async execute(options) {
            cachedDeps ??= createMongoRunnerDeps(
              options.driver,
              MongoDriverImpl.fromDb(extractDb(options.driver)),
              family,
            );
            const { driver: _, ...runnerOptions } = options;
            // The framework `MigrationRunner` interface types `destinationContract`
            // as `unknown`; the Mongo runner narrows to `MongoContract`. Validation
            // happens upstream — `migration apply` calls
            // `familyInstance.validateContract(migration.toContract)` before
            // routing the contract here (see
            // `packages/1-framework/3-tooling/cli/src/control-api/operations/migration-apply.ts`),
            // so this cast simply preserves the framework signature without
            // weakening the runner's typed surface or duplicating validation.
            return new MongoMigrationRunner(cachedDeps).execute({
              ...runnerOptions,
              destinationContract: runnerOptions.destinationContract as MongoContract,
            });
          },
          // Mongo per-space is a non-goal per the extension-contract-spaces project
          // spec (TML-2397): no Mongo extension contract spaces exist. The aggregate
          // is always single-member for Mongo, so `executeAcrossSpaces` is a
          // degenerate shim that asserts length === 1 and delegates to `execute`.
          // The shim exists so `applyAggregate` (the shared CLI primitive driving
          // `db init` / `db update` / `migration apply`) routes through Mongo
          // identically to the SQL family.
          async executeAcrossSpaces({ driver, perSpaceOptions }): Promise<MultiSpaceRunnerResult> {
            if (perSpaceOptions.length !== 1) {
              return notOk<MultiSpaceRunnerFailure>({
                code: 'MONGO_MULTI_SPACE_UNSUPPORTED',
                summary: `Mongo target supports a single contract space; received ${perSpaceOptions.length}`,
                failingSpace: perSpaceOptions[0]?.space ?? '<unknown>',
              });
            }
            const only = perSpaceOptions[0];
            if (!only) {
              return notOk<MultiSpaceRunnerFailure>({
                code: 'MONGO_MULTI_SPACE_UNSUPPORTED',
                summary: 'Mongo executeAcrossSpaces called with no per-space plans',
                failingSpace: '<unknown>',
              });
            }
            const result = await runner.execute({ ...only, driver });
            if (!result.ok) {
              return notOk<MultiSpaceRunnerFailure>({
                ...result.failure,
                failingSpace: only.space,
              });
            }
            return ok({
              perSpaceResults: [{ space: only.space, value: result.value }],
            });
          },
        };
      return runner;
    },
    contractToSchema(contract: Contract | null) {
      return contractToMongoSchemaIR(contract as MongoContract | null);
    },
  },
  create() {
    return { familyId: 'mongo' as const, targetId: 'mongo' as const };
  },
};
