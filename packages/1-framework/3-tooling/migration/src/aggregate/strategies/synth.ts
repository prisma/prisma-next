import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlAdapterInstance,
  ControlFamilyInstance,
  DiffIssue,
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationPlannerConflict,
  MigrationPlannerResult,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import { blindCast } from '@prisma-next/utils/casts';
import type { ContractMarkerRecordLike } from '../marker-types';
import type { PerSpacePlan } from '../planner-types';
import { buildSynthMigrationEdge } from '../synth-migration-edge';
import type { AggregateContractSpace } from '../types';

export interface SynthStrategyInputs<TFamilyId extends string, TTargetId extends string> {
  readonly aggregateTargetId: string;
  readonly currentMarker: ContractMarkerRecordLike | null;
  readonly space: AggregateContractSpace;
  /**
   * Ownership query over the passive contract-space aggregate: does a contract
   * space OTHER than this one declare a storage entity with this bare name?
   * The strategy uses it to scope the planner's diff (see
   * {@link keepIssuesOfThisSpace}); it runs no diff of its own.
   */
  readonly declaredByAnotherSpace: (entityName: string) => boolean;
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
 * The bare entity name a diff issue addresses, for ownership scoping.
 *
 * Node-typed issues carry the entity name one of two ways: an auxiliary or
 * structural node (e.g. a Postgres RLS policy) references its owning table
 * via `tableName`; a table (or namespace) node's own identity is its `name`.
 * `diffRole` (declared on every SQL schema-diff node, read here structurally
 * since this framework-level module can't import the SQL family's type)
 * disambiguates the second case from an auxiliary node's own `name` (e.g. a
 * column, index, or constraint name), which is never an entity to scope by.
 */
function issueEntityName(issue: DiffIssue): string | undefined {
  if ('outcome' in issue) {
    const actual = issue.actual;
    if (actual === undefined) return undefined;
    const node = blindCast<
      { readonly tableName?: unknown; readonly name?: unknown; readonly diffRole?: unknown },
      'entity-name scoping reads the optional target-specific tableName/name/diffRole off a diff node'
    >(actual);
    if (typeof node.tableName === 'string') return node.tableName;
    if (
      (node.diffRole === 'table' || node.diffRole === 'namespace') &&
      typeof node.name === 'string'
    ) {
      return node.name;
    }
    return undefined;
  }
  return 'table' in issue ? issue.table : undefined;
}

/**
 * Builds the keep-predicate the planner applies to its diff: drop the
 * `not-expected` findings for entities another contract space declares (so the
 * planner never emits DROP ops against a sibling space's tables), keep
 * everything else — including `not-expected` findings no space declares, which
 * the planner may DROP under a destructive policy.
 */
function keepIssuesOfThisSpace(
  declaredByAnotherSpace: (entityName: string) => boolean,
): (issue: DiffIssue) => boolean {
  return (issue) => {
    if (issue.reason !== 'not-expected') return true;
    const name = issueEntityName(issue);
    return name === undefined || !declaredByAnotherSpace(name);
  };
}

/**
 * Synthesise a migration plan for a single contract space from the full live
 * schema, delegating to the family's `createPlanner(...).plan(...)`.
 *
 * The planner diffs the whole introspected schema, so it sees other contract
 * spaces' tables as "extras"; the orchestration scopes the diff by handing the
 * planner a keep-predicate (built over the passive aggregate's ownership
 * query) that drops exactly those extras, so the planner never emits a
 * destructive drop for a sibling space's table and holds no ownership logic.
 * The schema is never pruned before planning.
 *
 * The synthesised plan's `targetId` is set from `aggregateTargetId`
 * (the aggregate's ambient target). The family's planner does not
 * stamp `targetId` on the produced plan; the aggregate planner is
 * the single point that knows the target.
 *
 * Used by:
 *
 * - The app space by default (CLI policy
 *   `ignoreGraphFor: { app.spaceId }`).
 * - Any extension space whose `headRef.invariants` is empty (the
 *   strategy selector falls back to synth when graph-walk isn't
 *   required).
 */
export async function synthStrategy<TFamilyId extends string, TTargetId extends string>(
  input: SynthStrategyInputs<TFamilyId, TTargetId>,
): Promise<SynthStrategyOutcome> {
  const planner = input.migrations.createPlanner(input.adapter);
  const plannerResult: MigrationPlannerResult = await (planner.plan({
    contract: input.space.contract(),
    schema: input.schemaIntrospection,
    policy: input.operationPolicy,
    fromContract: null,
    frameworkComponents: input.frameworkComponents,
    spaceId: input.space.spaceId,
    keepDiffIssue: keepIssuesOfThisSpace(input.declaredByAnotherSpace),
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
      destinationContract: input.space.contract(),
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
