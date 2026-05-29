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
import type {
  MigrationRunner,
  MigrationRunnerResult,
  MigrationRunnerSuccessValue,
  MultiSpaceCapableRunner,
  MultiSpaceRunnerFailure,
  MultiSpaceRunnerPerSpaceOptions,
  MultiSpaceRunnerResult,
} from '@prisma-next/framework-components/control';
import {
  type ContractSpaceMember,
  projectSchemaToSpace,
} from '@prisma-next/migration-tools/aggregate';
import type { MongoContract } from '@prisma-next/mongo-contract';
import type { MongoSchemaCollection } from '@prisma-next/mongo-schema-ir';
import { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
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
    createPlanner(_family: MongoControlFamilyInstance) {
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
      ): Promise<MigrationRunnerResult> => {
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

      const runner: MigrationRunner<'mongo', 'mongo'> & MultiSpaceCapableRunner<'mongo', 'mongo'> =
        {
          async execute(options) {
            const { driver, ...runnerOptions } = options;
            return runMongo(driver, runnerOptions);
          },
          // Mongo cannot wrap DDL ops in a session transaction (createCollection,
          // createIndex, collMod, setValidation all bypass transactions even on
          // replica sets), so the cross-space envelope is *resumable* rather than
          // transactional. Per-space-internal verify-gated marker atomicity
          // already lives in `runner.execute`: ops apply, schema is introspected
          // and verified, and the marker advances only on verify-pass. This loop
          // composes that guarantee across spaces — earlier-advanced markers are
          // not rolled back when a later space fails. Re-running reads each
          // marker, finds spaces 1..N−1 at-head (no-op skip), retries N onward.
          //
          // Per-space verify is sliced via `projectSchemaToSpace`: the live DB
          // holds collections owned by sibling spaces, but each space's verify
          // only sees the slice that space's contract actually claims. Without
          // the projection an aggregate of two spaces could not pass strict
          // verify (every other-space collection would look like an extra).
          //
          // See `docs/architecture docs/subsystems/10. MongoDB Family.md` §
          // Contract spaces and ADR 212 — Contract spaces.
          async executeAcrossSpaces({ driver, perSpaceOptions }): Promise<MultiSpaceRunnerResult> {
            const members = perSpaceOptions.map(toSpaceMember);
            const perSpaceResults: Array<{
              space: string;
              value: MigrationRunnerSuccessValue;
            }> = [];
            for (let i = 0; i < perSpaceOptions.length; i++) {
              const spaceOptions = perSpaceOptions[i];
              if (!spaceOptions) continue;
              const member = members[i];
              if (!member) continue;
              const others = members.filter((_, j) => j !== i);
              const projectSchema = (schema: MongoSchemaIR): MongoSchemaIR => {
                // `projectSchemaToSpace` returns a plain object
                // `{...schemaIR, collections: prunedArray}` (not a
                // `MongoSchemaIR` instance), so the descriptor rewraps
                // the pruned collections into a fresh `MongoSchemaIR`
                // before handing it to `verifyMongoSchema` (which
                // depends on the class's `collectionNames` /
                // `collection(name)` accessors).
                const projected = projectSchemaToSpace(schema, member, others) as {
                  readonly collections: ReadonlyArray<MongoSchemaCollection>;
                };
                return new MongoSchemaIR(projected.collections);
              };
              const result = await runMongo(driver, { ...spaceOptions, projectSchema });
              if (!result.ok) {
                return notOk<MultiSpaceRunnerFailure>({
                  ...result.failure,
                  failingSpace: spaceOptions.space,
                });
              }
              perSpaceResults.push({ space: spaceOptions.space, value: result.value });
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
 * Synthesise the minimum {@link projectSchemaToSpace}-compatible
 * `ContractSpaceMember` shape from a per-space option entry. The
 * projector only reads `spaceId` and `contract.storage`; the rest of
 * `ContractSpaceMember` (head ref invariants, hydrated migration
 * graph) is irrelevant at runner time and stubbed with sentinels.
 *
 * The `as unknown as ContractSpaceMember` cast is the load-bearing bit
 * — the projector duck-types its members so a sentinel-shaped graph
 * never gets read, but the framework type carries a richer shape.
 */
function toSpaceMember(
  opts: MultiSpaceRunnerPerSpaceOptions<'mongo', 'mongo'>,
): ContractSpaceMember {
  return {
    spaceId: opts.space,
    // Blind cast: `MultiSpaceRunnerPerSpaceOptions.destinationContract`
    // is intentionally typed `unknown` at the framework boundary
    // (the framework does not know which family's `Contract` shape
    // a runner consumes). The caller is the aggregate runner,
    // which only forwards a value already validated through the
    // family `deserializeContract` seam at the aggregate boundary.
    // `contract` is a lazy accessor on `ContractSpaceMember`; the
    // projector invokes it, so the thunk must return the value.
    contract: () => opts.destinationContract as unknown as Contract,
    headRef: { hash: '', invariants: [] },
    migrations: {
      graph: {
        nodes: new Set<string>(),
        forwardChain: new Map(),
        reverseChain: new Map(),
        migrationByHash: new Map(),
      },
      packagesByMigrationHash: new Map(),
    },
  } as unknown as ContractSpaceMember;
}
