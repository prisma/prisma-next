import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlAdapterInstance,
  ControlFamilyInstance,
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationPlannerConflict,
  MigrationPlannerResult,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import type { ContractMarkerRecordLike } from '../marker-types';
import type { PerSpacePlan } from '../planner-types';
import { otherMemberEntityNames } from '../scope-schema-result';
import { buildSynthMigrationEdge } from '../synth-migration-edge';
import type { ContractSpaceMember } from '../types';

export interface SynthStrategyInputs<TFamilyId extends string, TTargetId extends string> {
  readonly aggregateTargetId: string;
  readonly currentMarker: ContractMarkerRecordLike | null;
  readonly member: ContractSpaceMember;
  readonly otherMembers: ReadonlyArray<ContractSpaceMember>;
  readonly schemaIntrospection: unknown;
  readonly adapter: ControlAdapterInstance<TFamilyId, TTargetId>;
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId, unknown>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly operationPolicy: MigrationOperationPolicy;
}

export type SynthStrategyOutcome =
  | { readonly kind: 'ok'; readonly result: PerSpacePlan }
  | { readonly kind: 'failure'; readonly conflicts: readonly MigrationPlannerConflict[] };

/**
 * The {@link MigrationPlanner.plan} interface is declared as synchronous,
 * but historical and test fixture call sites have always invoked it
 * with `await` (see prior `db-apply-per-space.ts`). Tolerating a
 * Promise here keeps existing test mocks working without changing the
 * declared family SPI.
 */
type MaybeAsyncPlannerResult = MigrationPlannerResult | Promise<MigrationPlannerResult>;

/**
 * Synthesise a migration plan for a single member from the full live schema,
 * delegating to the family's `createPlanner(...).plan(...)`.
 *
 * The planner diffs the whole introspected schema, so it sees other members'
 * tables as "extras"; `entitiesOwnedByOtherSpaces` (every other member's
 * claimed entity names) tells it to drop those extras before building ops, so
 * it never emits a destructive drop for a sibling space's table. The schema is
 * never pruned before planning.
 *
 * The synthesised plan's `targetId` is set from `aggregateTargetId`
 * (the aggregate's ambient target). The family's planner does not
 * stamp `targetId` on the produced plan; the aggregate planner is
 * the single point that knows the target.
 *
 * Used by:
 *
 * - The app member by default (CLI policy
 *   `ignoreGraphFor: { app.spaceId }`).
 * - Any extension member whose `headRef.invariants` is empty (the
 *   strategy selector falls back to synth when graph-walk isn't
 *   required).
 */
export async function synthStrategy<TFamilyId extends string, TTargetId extends string>(
  input: SynthStrategyInputs<TFamilyId, TTargetId>,
): Promise<SynthStrategyOutcome> {
  const planner = input.migrations.createPlanner(input.adapter);
  const plannerResult: MigrationPlannerResult = await (planner.plan({
    contract: input.member.contract(),
    schema: input.schemaIntrospection,
    policy: input.operationPolicy,
    fromContract: null,
    frameworkComponents: input.frameworkComponents,
    spaceId: input.member.spaceId,
    entitiesOwnedByOtherSpaces: otherMemberEntityNames(input.member, input.otherMembers),
  }) as MaybeAsyncPlannerResult);

  if (plannerResult.kind === 'failure') {
    return { kind: 'failure', conflicts: plannerResult.conflicts };
  }

  const synthedPlan = plannerResult.plan;
  // The family planner returns a class-instance-shaped plan whose
  // `destination` / `operations` are accessors on the prototype, often
  // backed by private fields. A naive spread (`{ ...synthedPlan }`)
  // would lose those accessors and produce a plan with
  // `destination: undefined`; rebinding the prototype on a plain
  // object would break private-field access. We instead wrap the plan
  // in a Proxy that forwards every read except `targetId`, which is
  // stamped from the aggregate's ambient target. This preserves the
  // planner's class semantics while keeping the aggregate the single
  // source of truth for `targetId`.
  const plan: MigrationPlan = new Proxy(synthedPlan, {
    get(target, prop) {
      if (prop === 'targetId') return input.aggregateTargetId;
      // Forward `this` as the original target so prototype-bound
      // private fields (#destination, #operations, …) resolve.
      return Reflect.get(target, prop, target);
    },
    has(target, prop) {
      if (prop === 'targetId') return true;
      return Reflect.has(target, prop);
    },
  });

  const destinationStorageHash = synthedPlan.destination.storageHash;
  const synthedOps = await Promise.all(synthedPlan.operations);
  return {
    kind: 'ok',
    result: {
      plan,
      displayOps: synthedOps,
      destinationContract: input.member.contract(),
      strategy: 'synth',
      ...(plannerResult.warnings && plannerResult.warnings.length > 0
        ? { warnings: plannerResult.warnings }
        : {}),
      migrationEdges: [
        buildSynthMigrationEdge({
          currentMarkerStorageHash: input.currentMarker?.storageHash,
          destinationStorageHash,
          operationCount: synthedOps.length,
        }),
      ],
    },
  };
}
