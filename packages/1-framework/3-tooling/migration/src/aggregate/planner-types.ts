import type { Contract } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlAdapterInstance,
  ControlFamilyInstance,
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationPlannerConflict,
  MigrationPlanOperation,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import type { Result } from '@prisma-next/utils/result';
import type { PathDecision } from '../migration-graph';
import type { ContractMarkerRecordLike } from './marker-types';
import type { ContractSpaceAggregate } from './types';

/**
 * Caller-provided policy for {@link planMigration}. Today this carries
 * just one knob:
 *
 * - `ignoreGraphFor`: `Set<spaceId>`. For listed members, the planner
 *   forces the **synth** strategy (synthesise a plan from the contract
 *   IR via `familyInstance.createPlanner(...).plan(...)`) regardless of
 *   whether a graph is available. The CLI's daily-driver `db init` /
 *   `db update` pipelines pass `new Set([aggregate.app.spaceId])` to
 *   keep today's app-space behaviour: the user's authored
 *   `migrations/` directory is **not** walked for the app member, the
 *   plan is synthesised on the fly. Extension members are walked.
 *
 *   Listing a member here whose `headRef.invariants` is non-empty is
 *   a `policyConflict` — synth cannot satisfy authored invariants.
 */
export interface CallerPolicy {
  readonly ignoreGraphFor: ReadonlySet<string>;
}

/**
 * Snapshot of the live database state the planner needs to drive
 * strategy selection.
 *
 * - `markersBySpaceId`: per-space marker rows. Absent entry = no
 *   marker yet (greenfield space). The planner treats the marker's
 *   `storageHash` as the graph-walk's `from` node, falling back to
 *   {@link import('../constants').EMPTY_CONTRACT_HASH} when absent.
 * - `schemaIntrospection`: the family's full live schema IR. Fed into
 *   the synth strategy after per-space pre-projection via
 *   {@link import('./project-schema-to-space').projectSchemaToSpace}.
 *
 * Callers (CLI commands) gather this via the family's
 * `readAllMarkers` + `introspect` calls before invoking the planner.
 * The planner itself does not touch the database.
 */
export interface AggregateCurrentDBState {
  readonly markersBySpaceId: ReadonlyMap<string, ContractMarkerRecordLike | null>;
  readonly schemaIntrospection: unknown;
}

/**
 * Inputs to {@link planMigration}.
 *
 * The planner is target-agnostic but family-aware: per-member synth
 * delegates to the family's `createPlanner(adapter).plan(...)`,
 * which is why `adapter`, `migrations` (the
 * `TargetMigrationsCapability`), and `frameworkComponents` are all
 * threaded through. (`frameworkComponents` is passed verbatim into
 * `planner.plan(...)` per ADR 212; the planner does not interpret it.)
 *
 * The planner does **not** receive a `targetId` separately —
 * it reads `aggregate.targetId` and stamps it onto every emitted
 * `MigrationPlan` from construction. No placeholder, no patch step.
 */
export interface PlannerInput<TFamilyId extends string, TTargetId extends string> {
  readonly aggregate: ContractSpaceAggregate;
  readonly currentDBState: AggregateCurrentDBState;
  readonly adapter: ControlAdapterInstance<TFamilyId, TTargetId>;
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId, unknown>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly callerPolicy: CallerPolicy;
  readonly operationPolicy: MigrationOperationPolicy;
}

/**
 * Per-member output of the planner. The runner ingests this
 * shape directly via a thin `toRunnerInput` adapter at the CLI.
 *
 * - `plan`: ready-to-execute `MigrationPlan` with `targetId` already
 *   set from `aggregate.targetId`.
 * - `displayOps`: same operation list, surfaced separately so plan-mode
 *   output can render without touching the runner-bound `plan`.
 * - `destinationContract`: the typed contract value the runner uses
 *   for post-apply verification. For the app member, the user's
 *   contract; for extension members, the on-disk `contract.json`.
 * - `strategy`: which strategy produced this plan (`'graph-walk'` or
 *   `'synth'`). Surfaced for diagnostics; not consumed by the runner.
 */
/**
 * Per-edge metadata for the chain assembled by the graph-walk
 * strategy. Lets `migrate` surface a per-migration `applied[]`
 * entry (preserving the `migrationsApplied` count semantics) without
 * re-walking the graph.
 *
 * `synth`-produced plans leave this absent — synthesised plans don't
 * have authored edges to surface.
 */
export interface AggregateMigrationEdgeRef {
  readonly migrationHash: string;
  readonly dirName: string;
  readonly from: string;
  readonly to: string;
  readonly operationCount: number;
  /**
   * Contract IR JSON of the edge's destination state, threaded from the
   * bundle's on-disk `end-contract.json` snapshot (graph-walk) or the
   * member's destination contract (synth). Runners persist it as the
   * edge's ledger-linked contract row so database tooling can render
   * model-level diffs per applied migration; an edge's *before* state is
   * the previous row's snapshot by chain construction. Absent when the
   * source bundle carries no snapshot.
   */
  readonly destinationContractJson?: unknown;
}

export interface PerSpacePlan {
  readonly plan: MigrationPlan;
  readonly displayOps: readonly MigrationPlanOperation[];
  readonly destinationContract: Contract;
  readonly strategy: 'graph-walk' | 'synth';
  readonly warnings?: readonly MigrationPlannerConflict[];
  /**
   * Per-edge breakdown of the chain. Graph-walk plans carry one entry per
   * authored edge; synth and at-head plans carry a single synthesised edge.
   */
  readonly migrationEdges: readonly AggregateMigrationEdgeRef[];
  /**
   * Path decision data the strategy used to select the chain
   * (alternative count, tie-break reasons, required/satisfied
   * invariants, per-edge invariants). Populated by the graph-walk
   * strategy; absent for synth-produced plans.
   *
   * `migrate` surfaces this for the app member as
   * `MigrateSuccess.pathDecision` (back-compat with single-
   * space callers).
   */
  readonly pathDecision?: PathDecision;
}

export interface PlannerSuccess {
  readonly perSpace: ReadonlyMap<string, PerSpacePlan>;
  /**
   * `applyOrder` is the order the runner must walk per-space inputs.
   * Mirrors the existing `concatenateSpaceApplyInputs` convention:
   * extensions alphabetically by `spaceId`, then the app. Tests assert
   * on `MigrationRunnerFailure.failingSpace`, which is positional in
   * the runner's input array — preserving the literal ordering keeps
   * `failingSpace` attribution byte-for-byte.
   */
  readonly applyOrder: readonly string[];
}

/**
 * Discriminated failure variants for {@link planMigration}. Each
 * variant short-circuits the plan; per-member errors carry the
 * `spaceId` so the CLI can surface a precise envelope.
 */
export type PlannerError =
  | { readonly kind: 'extensionPathUnreachable'; readonly spaceId: string; readonly target: string }
  | {
      readonly kind: 'extensionPathUnsatisfiable';
      readonly spaceId: string;
      readonly missingInvariants: readonly string[];
    }
  | {
      readonly kind: 'appSynthFailure';
      readonly spaceId: string;
      readonly conflicts: readonly MigrationPlannerConflict[];
    }
  | { readonly kind: 'policyConflict'; readonly spaceId: string; readonly detail: string };

export type PlannerOutput = Result<PlannerSuccess, PlannerError>;
