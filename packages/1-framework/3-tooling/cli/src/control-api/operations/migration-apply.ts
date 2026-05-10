import type { Contract } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyInstance,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import {
  type AggregatePerSpacePlan,
  type ContractMarkerRecordLike,
  type ContractSpaceAggregate,
  type ContractSpaceMember,
  graphWalkStrategy,
} from '@prisma-next/migration-tools/aggregate';
import type { OnDiskMigrationPackage } from '@prisma-next/migration-tools/package';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import {
  type BuildAggregateInputs,
  buildContractSpaceAggregate,
} from '../../utils/contract-space-aggregate-loader';
import type {
  AggregatePerSpaceExecutionEntry,
  MigrationApplyFailure,
  MigrationApplyResult,
  MigrationApplySuccess,
  OnControlProgress,
} from '../types';
import { applyAggregate, buildPerSpaceBreakdown, collectOrdered } from './apply-aggregate';

/**
 * Inputs for the aggregate-walking `migration apply` control-api
 * operation.
 *
 * The CLI command resolves the descriptor surface (config, refs,
 * contract envelope) and hands a flat input through. The operation
 * is the single descriptor-free seam between the CLI and the
 * aggregate runtime.
 */
export interface ExecuteMigrationApplyOptions<TFamilyId extends string, TTargetId extends string> {
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  /** Already-validated app contract (the canonical "where we are heading" hash). */
  readonly contract: Contract;
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId, unknown>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly migrationsDir: string;
  readonly extensionPacks: ReadonlyArray<ControlExtensionDescriptor<TFamilyId, TTargetId>>;
  readonly targetId: TTargetId;
  /**
   * Already-loaded app-space migration packages. The CLI command
   * loads these via `loadMigrationPackages(appMigrationsDir)`; the
   * operation hydrates the app member's graph with them. Required
   * because the framework-neutral aggregate loader doesn't know how
   * to read the user's `migrations/` directory layout (it's family-
   * aware: ops.json shape, manifest keys, etc.).
   */
  readonly appMigrationPackages: ReadonlyArray<OnDiskMigrationPackage>;
  /**
   * Optional app-space ref override. When provided, the app member's
   * graph-walk targets this hash instead of `member.headRef.hash`.
   * Extensions are unaffected — they always walk to their own head.
   *
   * Sub-spec § `--ref <hash>` semantics under multi-space.
   */
  readonly refHash?: string;
  readonly onProgress?: OnControlProgress;
}

/**
 * Apply pending migrations across every contract space (app +
 * extensions). Replay-only: graph-walk against the on-disk graph for
 * every member; no synth, no introspection.
 *
 * Pipeline:
 *
 * 1. Load aggregate from disk (loader hydrates extension graphs;
 *    caller provides app-space packages).
 * 2. Read live marker rows per space (`familyInstance.readAllMarkers`).
 * 3. Per member: `graphWalkStrategy` plots the path from the live
 *    marker to `member.headRef.hash` (or `refHash` for the app
 *    member when provided). Empty-graph members fail loudly — a
 *    "never planned" space is a user-error condition for replay.
 * 4. Hand off to {@link applyAggregate} (the runner-driving tail
 *    shared with `db init` / `db update`). Marker advancement is
 *    inside the per-space transaction.
 *
 * Sub-spec § `migration apply` semantics + § Required changes 1.
 */
export async function executeMigrationApply<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteMigrationApplyOptions<TFamilyId, TTargetId>,
): Promise<MigrationApplyResult> {
  const {
    driver,
    familyInstance,
    contract,
    migrations,
    frameworkComponents,
    migrationsDir,
    extensionPacks,
    targetId,
    appMigrationPackages,
    refHash,
    onProgress,
  } = options;

  const loadInputs: BuildAggregateInputs<TFamilyId, TTargetId> = {
    targetId,
    migrationsDir,
    appContract: contract,
    extensionPacks,
    validateContract: (json) => familyInstance.validateContract(json),
    appMigrationPackages,
  };
  const loaded = await buildContractSpaceAggregate(loadInputs);
  if (!loaded.ok) {
    throw loaded.failure;
  }
  const aggregate = loaded.value;

  const markerRows = await familyInstance.readAllMarkers({ driver });

  // Plan every member via graph-walk. App member targets `refHash`
  // when provided, otherwise its own head; extensions always walk
  // to their own head ref.
  const allMembers: ReadonlyArray<ContractSpaceMember> = [aggregate.app, ...aggregate.extensions];
  const perSpacePlans = new Map<string, AggregatePerSpacePlan>();
  for (const member of allMembers) {
    const isAppMember = member.spaceId === aggregate.app.spaceId;
    const targetHash = isAppMember && refHash !== undefined ? refHash : member.headRef.hash;
    const liveMarker = markerRows.get(member.spaceId) ?? null;

    // Empty-graph members fail loudly: replay needs an on-disk path
    // and an empty graph means the user has never planned this space.
    if (member.migrations.graph.nodes.size === 0) {
      // Edge case: target == EMPTY (greenfield, nothing to do).
      // Loader integrity allows this for extensions whose head ref
      // is the empty sentinel. Treat as no-op for that member.
      const liveHash = liveMarker?.storageHash;
      if (targetHash === liveHash || (liveHash === undefined && targetHash === EMPTY_SENTINEL)) {
        continue; // skip — nothing to do
      }
      return notOk(buildNeverPlannedFailure(member.spaceId, targetHash));
    }

    const targetMember: ContractSpaceMember =
      targetHash === member.headRef.hash
        ? member
        : { ...member, headRef: { hash: targetHash, invariants: member.headRef.invariants } };

    const walked = graphWalkStrategy({
      aggregateTargetId: aggregate.targetId,
      member: targetMember,
      currentMarker: liveMarker,
    });
    if (walked.kind === 'unreachable') {
      return notOk(buildPathNotFoundFailure(member.spaceId, liveMarker, targetHash));
    }
    if (walked.kind === 'unsatisfiable') {
      return notOk(buildInvariantUnsatisfiableFailure(member.spaceId, walked.missing));
    }

    perSpacePlans.set(member.spaceId, walked.result);
  }

  const applyOrder = [...aggregate.extensions.map((m) => m.spaceId), aggregate.app.spaceId].filter(
    (spaceId) => perSpacePlans.has(spaceId),
  );

  // Short-circuit: nothing pending across any space.
  const totalPlannedOps = sumPlannedOps(applyOrder, perSpacePlans);
  if (totalPlannedOps === 0) {
    const orderedResolutions = collectOrdered(applyOrder, perSpacePlans);
    const perSpace = buildPerSpaceBreakdown(orderedResolutions, aggregate.app.spaceId, {
      includeMarkers: true,
    });
    return ok(
      buildSuccess({
        aggregate,
        orderedResolutions,
        perSpace,
        totalOpsExecuted: 0,
        summary:
          applyOrder.length === 0
            ? 'Already up to date — no contract spaces are loaded'
            : `Already up to date across ${applyOrder.length} space(s)`,
      }),
    );
  }

  const applied = await applyAggregate({
    aggregate,
    perSpacePlans,
    applyOrder,
    driver,
    familyInstance,
    migrations,
    frameworkComponents,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
    action: 'migrationApply',
    ...ifDefined('onProgress', onProgress),
  });

  if (!applied.ok) {
    const failure: MigrationApplyFailure = {
      code: 'RUNNER_FAILED',
      summary: applied.failure.summary,
      why: applied.failure.why,
      meta: applied.failure.meta,
    };
    return notOk(failure);
  }

  const summary = `Applied ${applied.value.totalOpsExecuted} operation(s) across ${applied.value.orderedResolutions.length} contract space(s)`;

  return ok(
    buildSuccess({
      aggregate,
      orderedResolutions: applied.value.orderedResolutions,
      perSpace: applied.value.perSpace,
      totalOpsExecuted: applied.value.totalOpsExecuted,
      summary,
    }),
  );
}

const EMPTY_SENTINEL = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

function sumPlannedOps(
  applyOrder: readonly string[],
  perSpacePlans: ReadonlyMap<string, AggregatePerSpacePlan>,
): number {
  let total = 0;
  for (const spaceId of applyOrder) {
    const entry = perSpacePlans.get(spaceId);
    if (!entry) continue;
    total += entry.plan.operations.length;
  }
  return total;
}

interface BuildSuccessArgs {
  readonly aggregate: ContractSpaceAggregate;
  readonly orderedResolutions: ReadonlyArray<{
    readonly spaceId: string;
    readonly entry: AggregatePerSpacePlan;
  }>;
  readonly perSpace: ReadonlyArray<AggregatePerSpaceExecutionEntry>;
  readonly totalOpsExecuted: number;
  readonly summary: string;
}

function buildSuccess(args: BuildSuccessArgs): MigrationApplySuccess {
  // The marker hash surfaced at the top level is the **app member's**
  // post-apply marker (today's single-space `markerHash` field).
  // Per-space markers live on `perSpace[].marker.storageHash`.
  const appResolution = args.orderedResolutions.find(
    (r) => r.spaceId === args.aggregate.app.spaceId,
  );
  const appMarkerHash =
    appResolution?.entry.plan.destination.storageHash ?? args.aggregate.app.headRef.hash;

  const applied = args.orderedResolutions.flatMap((r) => {
    const plan = r.entry.plan;
    if (plan.operations.length === 0) return [];
    // The graph-walk strategy reports the path's first edge `from`
    // and last edge `to` via `plan.origin` / `plan.destination`. We
    // surface the destination per space; the per-edge breakdown
    // lives in the formatter via `perSpace[].operations`.
    return [
      {
        spaceId: r.spaceId,
        from: plan.origin?.storageHash ?? null,
        to: plan.destination.storageHash,
        operationsExecuted: plan.operations.length,
      },
    ];
  });

  return {
    migrationsApplied: applied.length,
    markerHash: appMarkerHash,
    applied,
    summary: args.summary,
    perSpace: args.perSpace,
  };
}

function buildNeverPlannedFailure(spaceId: string, targetHash: string): MigrationApplyFailure {
  return {
    code: 'MIGRATION_PATH_NOT_FOUND',
    summary: `No on-disk migrations for contract space "${spaceId}"`,
    why: `migration apply is replay-only: every contract space must have an authored migration graph on disk. Space "${spaceId}" has no migrations under \`migrations/${spaceId}/\` but its head ref targets "${targetHash}". Run \`prisma-next migration plan\` first to materialise the path.`,
    meta: { spaceId, target: targetHash, kind: 'neverPlanned' },
  };
}

function buildPathNotFoundFailure(
  spaceId: string,
  marker: ContractMarkerRecordLike | null,
  targetHash: string,
): MigrationApplyFailure {
  const fromHash = marker?.storageHash ?? '<empty>';
  return {
    code: 'MIGRATION_PATH_NOT_FOUND',
    summary: `No migration path for contract space "${spaceId}"`,
    why: `Cannot reach target "${targetHash}" from current marker "${fromHash}" in space "${spaceId}". The on-disk migration graph for this space does not connect the two states.`,
    meta: { spaceId, fromHash, targetHash, kind: 'pathUnreachable' },
  };
}

function buildInvariantUnsatisfiableFailure(
  spaceId: string,
  missing: readonly string[],
): MigrationApplyFailure {
  return {
    code: 'MIGRATION_PATH_NOT_FOUND',
    summary: `No invariant-satisfying migration path for contract space "${spaceId}"`,
    why: `On-disk migration graph for space "${spaceId}" reaches the target but does not cover required invariants: ${missing.join(', ')}.`,
    meta: { spaceId, missingInvariants: missing, kind: 'invariantsUnsatisfiable' },
  };
}
