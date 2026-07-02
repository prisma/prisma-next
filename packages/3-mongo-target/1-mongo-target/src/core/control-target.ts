import {
  createMongoRunnerDeps,
  extractDb,
  type MongoRunnerDependencies,
} from '@prisma-next/adapter-mongo/control';
import type { Contract } from '@prisma-next/contract/types';
import { MongoDriverImpl } from '@prisma-next/driver-mongo';
import type {
  MongoControlFamilyInstance,
  MongoControlTargetDescriptor,
} from '@prisma-next/family-mongo/control';
import { contractToMongoSchemaIR } from '@prisma-next/family-mongo/control';
import type { MongoControlAdapter } from '@prisma-next/family-mongo/control-adapter';
import type {
  MigrationRunner,
  MigrationRunnerPerSpaceOptions,
  MigrationRunnerPerSpaceSuccessValue,
  MigrationRunnerResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import {
  createContractSpaceMember,
  otherMemberEntityNames,
  scopeSchemaResultToSpace,
} from '@prisma-next/migration-tools/aggregate';
import type { MongoContract } from '@prisma-next/mongo-contract';
import { blindCast } from '@prisma-next/utils/casts';
import { notOk, ok } from '@prisma-next/utils/result';
import { mongoTargetDescriptorMeta } from './descriptor-meta';
import { MongoMigrationPlanner } from './mongo-planner';
import { MongoMigrationRunner, type MongoMigrationRunnerExecuteOptions } from './mongo-runner';
import type { MongoTargetContract } from './mongo-target-contract';
import { MongoTargetContractSerializer } from './mongo-target-contract-serializer';
import { MongoTargetSchemaVerifier } from './mongo-target-schema-verifier';

export type { MongoControlTargetDescriptor };

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
export const mongoTargetDescriptor: MongoControlTargetDescriptor<MongoTargetContract> = {
  ...mongoTargetDescriptorMeta,
  contractSerializer: new MongoTargetContractSerializer(),
  schemaVerifier: new MongoTargetSchemaVerifier(),
  migrations: {
    createPlanner(_adapter: MongoControlAdapter<'mongo'>) {
      return new MongoMigrationPlanner();
    },
    createRunner(family: MongoControlFamilyInstance) {
      // Deps are bound to the first driver passed to execute() and cached for
      // subsequent calls. Callers must not change the driver between calls.
      let cachedDeps: MongoRunnerDependencies | undefined;

      const runMongo = async (
        driver: Parameters<MigrationRunner<'mongo', 'mongo'>['execute']>[0]['driver'],
        runnerOptions: Omit<MongoMigrationRunnerExecuteOptions, 'destinationContract'> & {
          readonly destinationContract: unknown;
        },
      ) => {
        cachedDeps ??= createMongoRunnerDeps(
          driver,
          MongoDriverImpl.fromDb(extractDb(driver)),
          family,
        );
        // The framework `MigrationRunner` interface types `destinationContract`
        // as `unknown`; the Mongo runner narrows to `MongoContract`. Validation
        // happens upstream — `migrate` calls
        // `familyInstance.deserializeContract(contract)` on the project-root
        // contract loaded from disk before routing it here, so this cast
        // preserves the framework signature without weakening the runner's
        // typed surface.
        return new MongoMigrationRunner(cachedDeps).execute({
          ...runnerOptions,
          destinationContract: runnerOptions.destinationContract as MongoContract,
        });
      };

      const runner: MigrationRunner<'mongo', 'mongo'> = {
        // Mongo cannot wrap DDL ops in a session transaction (createCollection,
        // createIndex, collMod, setValidation all bypass transactions even on
        // replica sets), so the cross-space envelope is *resumable* rather than
        // transactional. Per-space-internal verify-gated marker atomicity
        // already lives in `MongoMigrationRunner.execute`: ops apply, schema is
        // introspected and verified, and the marker advances only on verify-pass.
        // This loop composes that guarantee across spaces — earlier-advanced
        // markers are not rolled back when a later space fails. Re-running reads
        // each marker, finds spaces 1..N−1 at-head (no-op skip), retries N onward.
        //
        // Per-space verify is scoped by `scopeSchemaResultToSpace`: the live DB
        // holds collections owned by sibling spaces, so each space verifies the
        // full schema and then drops the `extra` findings for the collections a
        // sibling space claims. Without the scoping an aggregate of two spaces
        // could not pass strict verify (every other-space collection would look
        // like an extra).
        //
        // See `docs/architecture docs/subsystems/10. MongoDB Family.md` §
        // Contract spaces and ADR 212 — Contract spaces.
        async execute({ driver, perSpaceOptions }): Promise<MigrationRunnerResult> {
          const members = perSpaceOptions.map(toSpaceMember);
          const perSpaceResults: Array<{
            space: string;
            value: MigrationRunnerPerSpaceSuccessValue;
          }> = [];
          for (let i = 0; i < perSpaceOptions.length; i++) {
            const spaceOptions = perSpaceOptions[i];
            if (!spaceOptions) continue;
            const member = members[i];
            if (!member) continue;
            const others = members.filter((_, j) => j !== i);
            // The runner verifies the destination contract against the full
            // introspected schema; scope the result to this space, dropping the
            // `extra` findings for collections a sibling space owns.
            const ownedByOthers = otherMemberEntityNames(member, others);
            const scopeVerifyResult = (
              result: VerifyDatabaseSchemaResult,
            ): VerifyDatabaseSchemaResult => scopeSchemaResultToSpace(result, ownedByOthers);
            const { space, ...runnerOptions } = spaceOptions;
            const result = await runMongo(driver, { ...runnerOptions, scopeVerifyResult });
            if (!result.ok) {
              return notOk({
                ...result.failure,
                failingSpace: space,
              });
            }
            perSpaceResults.push({ space, value: result.value });
          }
          return ok({ perSpaceResults });
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

/**
 * Synthesise a {@link ContractSpaceMember}-shaped value from a per-space option
 * entry, for `otherMemberEntityNames`. Only `spaceId` and `contract()` are
 * read; migration graph state is empty because the runner consumes the
 * destination contract directly.
 */
function toSpaceMember(opts: MigrationRunnerPerSpaceOptions<'mongo', 'mongo'>) {
  const contract = blindCast<Contract, 'destinationContract validated at aggregate boundary'>(
    opts.destinationContract,
  );
  return createContractSpaceMember({
    spaceId: opts.space,
    packages: [],
    refs: {},
    headRef: null,
    refsDir: '',
    resolveContract: () => contract,
    deserializeContract: (raw) =>
      blindCast<Contract, 'destinationContract validated at aggregate boundary'>(raw),
  });
}
