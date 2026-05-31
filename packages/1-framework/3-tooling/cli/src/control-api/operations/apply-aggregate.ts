import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationOperationPolicy,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import type {
  AggregatePerSpacePlan,
  ContractSpaceAggregate,
} from '@prisma-next/migration-tools/aggregate';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import type { AggregatePerSpaceExecutionEntry, OnControlProgress } from '../types';

/**
 * Span id emitted via `onProgress` for the apply phase. Stable
 * identifier consumed by the structured-output renderer and by tests.
 */
const APPLY_SPAN_ID = 'apply' as const;

/**
 * Action that originated this apply call. Threaded into `OnControlProgress`
 * events so the parent CLI command can attribute the span correctly,
 * and used to compose action-specific summary phrasing.
 */
export type AggregateApplyAction = 'dbInit' | 'dbUpdate' | 'migrationApply';

/**
 * Failure variant emitted by {@link applyAggregate} when the multi-space
 * runner itself rejects the apply. Mirrors the failure shape callers
 * already wrap into their own action-specific failure envelopes
 * (`DbInitFailure`, `DbUpdateFailure`, `MigrationApplyFailure`) so each
 * caller keeps owning its own discriminated failure code.
 */
export interface AggregateApplyRunnerFailure {
  readonly summary: string;
  readonly why?: string;
  readonly meta: Record<string, unknown>;
}

export interface ApplyAggregateInputs<TFamilyId extends string, TTargetId extends string> {
  readonly aggregate: ContractSpaceAggregate;
  /**
   * Per-space plans, keyed by `spaceId`. Produced by either the full
   * {@link planAggregate} pipeline (`db init` / `db update` — synth
   * for the app, graph-walk for extensions) or by direct
   * {@link graphWalkStrategy} calls (`migrate` — graph-walk
   * for every member). Either way, the runner consumes the same shape.
   */
  readonly perSpacePlans: ReadonlyMap<string, AggregatePerSpacePlan>;
  /**
   * Canonical schedule order — extensions alphabetically by `spaceId`,
   * then app. Mirrors {@link import('@prisma-next/migration-tools/concatenate-space-apply-inputs').concatenateSpaceApplyInputs}'s
   * convention so `MigrationRunnerFailure.failingSpace` attribution
   * stays byte-for-byte stable across callers.
   */
  readonly applyOrder: readonly string[];
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId, unknown>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly policy: MigrationOperationPolicy;
  readonly action: AggregateApplyAction;
  readonly onProgress?: OnControlProgress;
}

/**
 * Resolved per-space plan in canonical schedule order. Surfaced from
 * {@link applyAggregate} to callers so each one can build its own
 * action-specific success envelope (e.g. `DbInitSuccess` vs
 * `MigrationApplySuccess`) without re-deriving the ordering.
 */
export interface OrderedResolution {
  readonly spaceId: string;
  readonly entry: AggregatePerSpacePlan;
}

export interface ApplyAggregateValue {
  readonly orderedResolutions: readonly OrderedResolution[];
  readonly totalOpsPlanned: number;
  readonly totalOpsExecuted: number;
  /**
   * Per-space breakdown ready to thread into action-specific success
   * envelopes. Each entry carries the post-apply marker (live storage hash
   * plus invariants) so callers can render it directly without re-reading.
   */
  readonly perSpace: readonly AggregatePerSpaceExecutionEntry[];
}

export type ApplyAggregateResult = Result<ApplyAggregateValue, AggregateApplyRunnerFailure>;

/**
 * Runner-driving tail shared by every aggregate apply caller — `db init`,
 * `db update`, and `migrate`. Consumes already-resolved per-space
 * plans (the planner-vs-replay distinction is owned by the caller) and
 * dispatches them to the multi-space runner in canonical order.
 *
 * Marker advancement is part of the runner's per-space transaction
 * (the SQL family runner writes the marker as the last step of each
 * space's transaction), so this primitive does not advance markers
 * separately — by the time `execute` returns ok, every
 * space's marker has been advanced to its plan's destination.
 *
 * Span emission (`spanStart 'apply'` / `spanEnd 'apply'`) is owned here
 * so callers don't have to duplicate it; the `action` field on each
 * progress event is taken from the caller's `action` argument.
 */
export async function applyAggregate<TFamilyId extends string, TTargetId extends string>(
  inputs: ApplyAggregateInputs<TFamilyId, TTargetId>,
): Promise<ApplyAggregateResult> {
  const {
    aggregate,
    perSpacePlans,
    applyOrder,
    driver,
    familyInstance,
    migrations,
    frameworkComponents,
    policy,
    action,
    onProgress,
  } = inputs;

  const orderedResolutions = collectOrdered(applyOrder, perSpacePlans);

  const runner = migrations.createRunner(familyInstance);

  onProgress?.({
    action,
    kind: 'spanStart',
    spanId: APPLY_SPAN_ID,
    label: progressLabelForAction(action),
  });

  const perSpaceOptions = orderedResolutions.map((r) => ({
    space: r.spaceId,
    plan: r.entry.plan,
    driver,
    destinationContract: r.entry.destinationContract,
    policy,
    frameworkComponents,
    // Per-space post-apply schema verification is non-strict: each
    // space's `destinationContract` describes only its own slice; a
    // strict verifier would treat every other space's tables as
    // `extras`. Tolerant mode still catches missing tables / columns.
    strictVerification: false,
  }));

  const runnerResult = await runner.execute({ driver, perSpaceOptions });

  if (!runnerResult.ok) {
    onProgress?.({ action, kind: 'spanEnd', spanId: APPLY_SPAN_ID, outcome: 'error' });
    return notOk({
      summary: runnerResult.failure.summary,
      ...ifDefined('why', runnerResult.failure.why),
      meta: {
        ...(runnerResult.failure.meta ?? {}),
        failingSpace: runnerResult.failure.failingSpace,
        runnerErrorCode: runnerResult.failure.code,
      },
    });
  }
  onProgress?.({ action, kind: 'spanEnd', spanId: APPLY_SPAN_ID, outcome: 'ok' });

  const totalOpsPlanned = runnerResult.value.perSpaceResults.reduce(
    (sum, r) => sum + r.value.operationsPlanned,
    0,
  );
  const totalOpsExecuted = runnerResult.value.perSpaceResults.reduce(
    (sum, r) => sum + r.value.operationsExecuted,
    0,
  );

  const perSpace = buildPerSpaceBreakdown(orderedResolutions, aggregate.app.spaceId, {
    includeMarkers: true,
  });

  return ok({
    orderedResolutions,
    totalOpsPlanned,
    totalOpsExecuted,
    perSpace,
  });
}

/**
 * Project the planner's per-space resolutions into the
 * `AggregatePerSpaceExecutionEntry[]` shape the CLI surfaces.
 *
 * `includeMarkers` is `true` for apply-mode (each space's marker is
 * the `destination.storageHash` of its plan, which the runner
 * advances as the last step of each space's transaction) and `false`
 * for plan-mode (no marker has been written yet).
 *
 * Exported alongside {@link applyAggregate} so plan-mode callers can
 * assemble the same per-space block without going through the runner.
 */
export function buildPerSpaceBreakdown(
  orderedResolutions: readonly OrderedResolution[],
  appSpaceId: string,
  options: { readonly includeMarkers: boolean },
): readonly AggregatePerSpaceExecutionEntry[] {
  return orderedResolutions.map((r) => {
    const operations = r.entry.displayOps.map((op) => ({
      id: op.id,
      label: op.label,
      operationClass: op.operationClass,
    }));
    const base: AggregatePerSpaceExecutionEntry = {
      spaceId: r.spaceId,
      kind: r.spaceId === appSpaceId ? 'app' : 'extension',
      operations,
    };
    if (!options.includeMarkers) return base;
    return {
      ...base,
      marker: { storageHash: r.entry.plan.destination.storageHash },
    };
  });
}

/**
 * Materialise the `applyOrder` ordering into resolved per-space
 * entries. Throws if the planner output is missing a member listed
 * in `applyOrder` — a wiring bug that should never reach runtime.
 *
 * Exported so callers building their own success envelopes after a
 * plan-mode dispatch can replay the same ordering.
 */
export function collectOrdered(
  applyOrder: readonly string[],
  perSpace: ReadonlyMap<string, AggregatePerSpacePlan>,
): readonly OrderedResolution[] {
  return applyOrder.map((spaceId) => {
    const entry = perSpace.get(spaceId);
    if (!entry) {
      throw new Error(`Aggregate planner output missing per-space plan for "${spaceId}"`);
    }
    return { spaceId, entry };
  });
}

/**
 * Action-appropriate label for the `spanStart` event the apply
 * primitive emits. `applyAggregate` is shared by `db init`, `db update`,
 * and `migrate`; the span label tracks the user-visible action
 * so structured-progress output reads naturally for each surface.
 */
export function progressLabelForAction(action: AggregateApplyAction): string {
  switch (action) {
    case 'dbInit':
      return 'Initialising database across spaces';
    case 'dbUpdate':
      return 'Updating database across spaces';
    case 'migrationApply':
      return 'Applying migration plan across spaces';
  }
}
