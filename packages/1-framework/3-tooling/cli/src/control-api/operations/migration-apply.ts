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
import { errorNoInvariantPath } from '@prisma-next/migration-tools/errors';
import { findPathWithDecision } from '@prisma-next/migration-tools/migration-graph';
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
  MigrationApplyPathDecision,
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
  /**
   * Required invariants attached to the user-supplied app-space ref.
   * Threaded into the graph-walk's `required` calculation so the
   * planner picks an invariant-bearing path and surfaces the
   * required/satisfied set on the success envelope. When `refHash`
   * is absent the file's `member.headRef.invariants` are used.
   */
  readonly refInvariants?: readonly string[];
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
    refInvariants,
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

    const targetInvariants =
      isAppMember && refHash !== undefined && refInvariants !== undefined
        ? refInvariants
        : member.headRef.invariants;
    const targetMember: ContractSpaceMember =
      targetHash === member.headRef.hash && targetInvariants === member.headRef.invariants
        ? member
        : { ...member, headRef: { hash: targetHash, invariants: targetInvariants } };

    const walked = graphWalkStrategy({
      aggregateTargetId: aggregate.targetId,
      member: targetMember,
      currentMarker: liveMarker,
    });
    if (walked.kind === 'unreachable') {
      return notOk(buildPathNotFoundFailure(member.spaceId, liveMarker, targetHash));
    }
    if (walked.kind === 'unsatisfiable') {
      // Surface the canonical MIGRATION.NO_INVARIANT_PATH envelope
      // (the error rendering pipeline maps it to meta.code +
      // meta.required + meta.missing + meta.structuralPath that the
      // cli-journeys invariant suite asserts on).
      const fromHash = liveMarker?.storageHash ?? '';
      const structural = findPathWithDecision(targetMember.migrations.graph, fromHash, targetHash, {
        required: new Set<string>(),
      });
      const structuralPath =
        structural.kind === 'ok'
          ? structural.decision.selectedPath.map((edge) => ({
              dirName: edge.dirName,
              migrationHash: edge.migrationHash,
              from: edge.from,
              to: edge.to,
              invariants: edge.invariants,
            }))
          : [];
      throw errorNoInvariantPath({
        ...(refHash !== undefined ? { refName: 'app-ref' } : {}),
        required: targetInvariants,
        missing: walked.missing,
        structuralPath,
      });
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
            : applyOrder.length === 1
              ? 'Already up to date'
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

  const totalMigrationsApplied = applied.value.orderedResolutions.reduce(
    (sum, r) => sum + (r.entry.migrationEdges?.length ?? 0),
    0,
  );
  const summary = `Applied ${totalMigrationsApplied} migration(s) (${applied.value.totalOpsExecuted} operation(s)) across ${applied.value.orderedResolutions.length} contract space(s)`;

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

  // Per-migration entries (one per authored edge) preserve the
  // single-space `migrationsApplied` count semantics for back-compat
  // with existing JSON-shape consumers (e.g. `parsed.applied.length`
  // in integration tests). The aggregate per-space breakdown lives on
  // `perSpace[]`.
  const applied = args.orderedResolutions.flatMap((r) => {
    const edges = r.entry.migrationEdges ?? [];
    return edges.map((edge) => ({
      spaceId: r.spaceId,
      dirName: edge.dirName,
      migrationHash: edge.migrationHash,
      from: edge.from,
      to: edge.to,
      operationsExecuted: edge.operationCount,
    }));
  });

  const appPlan = appResolution?.entry;
  const pathDecision: MigrationApplyPathDecision | undefined = appPlan?.pathDecision
    ? {
        fromHash: appPlan.pathDecision.fromHash,
        toHash: appPlan.pathDecision.toHash,
        alternativeCount: appPlan.pathDecision.alternativeCount,
        tieBreakReasons: appPlan.pathDecision.tieBreakReasons,
        ...(appPlan.pathDecision.refName !== undefined
          ? { refName: appPlan.pathDecision.refName }
          : {}),
        requiredInvariants: appPlan.pathDecision.requiredInvariants ?? [],
        satisfiedInvariants: appPlan.pathDecision.satisfiedInvariants ?? [],
        selectedPath: appPlan.pathDecision.selectedPath.map((entry) => ({
          dirName: entry.dirName,
          migrationHash: entry.migrationHash,
          from: entry.from,
          to: entry.to,
          invariants: entry.invariants,
        })),
      }
    : undefined;

  return {
    migrationsApplied: applied.length,
    markerHash: appMarkerHash,
    applied,
    summary: args.summary,
    perSpace: args.perSpace,
    ...(pathDecision !== undefined ? { pathDecision } : {}),
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
  // The single-space-degenerate phrasing names the user-visible
  // condition (a contract has been emitted that no on-disk
  // migration reaches) so the error reads naturally for the
  // single-space app case. Multi-space callers see the same
  // condition expressed against the offending space.
  const summary =
    spaceId === 'app'
      ? 'Current contract has no planned migration path'
      : `Current contract has no planned migration path for contract space "${spaceId}"`;
  return {
    code: 'MIGRATION_PATH_NOT_FOUND',
    summary,
    why: `Cannot reach target "${targetHash}" from current marker "${fromHash}" in space "${spaceId}". The on-disk migration graph for this space does not connect the two states. Run \`prisma-next migration plan\` to materialise the path.`,
    meta: { spaceId, fromHash, targetHash, kind: 'pathUnreachable' },
  };
}
