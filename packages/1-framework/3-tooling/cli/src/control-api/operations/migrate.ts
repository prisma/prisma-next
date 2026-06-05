/**
 * Backs the `migrate` command. Strategy: graph-walk-all-members, replay-only (no introspect/synth/planner).
 */

import type { Contract } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyInstance,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import {
  buildSynthMigrationEdge,
  type ContractMarkerRecordLike,
  type ContractSpaceAggregate,
  type ContractSpaceMember,
  graphWalkStrategy,
  type PerSpacePlan,
  requireHeadRef,
} from '@prisma-next/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { errorNoInvariantPath } from '@prisma-next/migration-tools/errors';
import { findPathWithDecision } from '@prisma-next/migration-tools/migration-graph';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import {
  type BuildAggregateInputs,
  buildContractSpaceAggregate,
} from '../../utils/contract-space-aggregate-loader';
import type {
  MigrateFailure,
  MigratePathDecision,
  MigrateResult,
  MigrateSuccess,
  OnControlProgress,
  PerSpaceExecutionEntry,
} from '../types';
import { buildPerSpaceBreakdown, runMigration } from './run-migration';

/**
 * Inputs for the aggregate-walking `migrate` control-api
 * operation.
 *
 * The CLI command resolves the descriptor surface (config, refs,
 * contract envelope) and hands a flat input through. The operation
 * is the single descriptor-free seam between the CLI and the
 * aggregate runtime.
 */
export interface ExecuteMigrateOptions<TFamilyId extends string, TTargetId extends string> {
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
   * Optional app-space ref override. When provided, the app member's
   * graph-walk targets this hash instead of `member.headRef.hash`.
   * Extensions are unaffected — they always walk to their own head.
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
  /**
   * Resolved name of the user-supplied app-space ref. Surfaces in
   * `pathDecision.refName` and in `MIGRATION.NO_INVARIANT_PATH`
   * error envelopes so diagnostics name what the user actually
   * passed (`--ref prod`) instead of a synthetic placeholder.
   * Ignored when `refHash` is absent.
   */
  readonly refName?: string;
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
 * 4. Hand off to {@link runMigration} (the runner-driving tail
 *    shared with `db init` / `db update`). Marker advancement is
 *    inside the per-space transaction.
 *
 * Encodes the replay-only contract: every contract space must have an
 * authored migration graph on disk before this operation can advance it.
 */
export async function executeMigrate<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteMigrateOptions<TFamilyId, TTargetId>,
): Promise<MigrateResult> {
  const {
    driver,
    familyInstance,
    contract,
    migrations,
    frameworkComponents,
    migrationsDir,
    extensionPacks,
    targetId,
    refHash,
    refInvariants,
    refName,
    onProgress,
  } = options;

  const loadInputs: BuildAggregateInputs<TFamilyId, TTargetId> = {
    targetId,
    migrationsDir,
    appContract: contract,
    extensionPacks,
    deserializeContract: (json) => familyInstance.deserializeContract(json),
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
  const perSpacePlans = new Map<string, PerSpacePlan>();
  // Already-at-head empty-graph members (typically extensions whose
  // head ref is the empty sentinel, or whose live marker already
  // matches the target). Kept out of the runner schedule so we don't
  // write spurious markers for greenfield extensions, but merged back
  // into the success envelope so every loaded member is represented.
  const atHeadResolutions = new Map<string, PerSpacePlan>();
  for (const member of allMembers) {
    const isAppMember = member.spaceId === aggregate.app.spaceId;
    // The aggregate passed the integrity gate, so every member's head ref
    // is resolved (the app's is synthesised from the live contract).
    const headRef = requireHeadRef(member);
    const targetHash = isAppMember && refHash !== undefined ? refHash : headRef.hash;
    const liveMarker = markerRows.get(member.spaceId) ?? null;

    // Empty-graph members fail loudly: replay needs an on-disk path
    // and an empty graph means the user has never planned this space.
    if (member.graph().nodes.size === 0) {
      // Edge case: target == EMPTY (greenfield, nothing to do) or
      // the live marker already matches the target. Loader integrity
      // allows this for extensions whose head ref is the empty
      // sentinel. Record a zero-op resolution so the aggregate result
      // still surfaces the member in `perSpace[]` as already-at-head;
      // the runner is not invoked for these members because they have
      // no authored ops and (for greenfield extensions) no marker to
      // advance.
      const liveHash = liveMarker?.storageHash;
      if (
        targetHash === liveHash ||
        (liveHash === undefined && targetHash === EMPTY_CONTRACT_HASH)
      ) {
        atHeadResolutions.set(
          member.spaceId,
          buildAtHeadResolution({
            aggregateTargetId: aggregate.targetId,
            member,
            targetHash,
            liveMarker,
          }),
        );
        continue;
      }
      return notOk(buildNeverPlannedFailure(member.spaceId, targetHash));
    }

    const targetInvariants =
      isAppMember && refHash !== undefined && refInvariants !== undefined
        ? refInvariants
        : headRef.invariants;
    const targetMember: ContractSpaceMember =
      targetHash === headRef.hash && targetInvariants === headRef.invariants
        ? member
        : { ...member, headRef: { hash: targetHash, invariants: targetInvariants } };

    const walked = graphWalkStrategy({
      aggregateTargetId: aggregate.targetId,
      member: targetMember,
      currentMarker: liveMarker,
      ...(isAppMember && refName !== undefined ? { refName } : {}),
    });
    if (walked.kind === 'unreachable') {
      return notOk(buildPathNotFoundFailure(member.spaceId, liveMarker, targetHash));
    }
    if (walked.kind === 'unsatisfiable') {
      // Surface the canonical MIGRATION.NO_INVARIANT_PATH envelope
      // (the error rendering pipeline maps it to meta.code +
      // meta.required + meta.missing + meta.structuralPath that the
      // cli-journeys invariant suite asserts on).
      // Greenfield runs (no marker yet) use the canonical empty-hash
      // sentinel so the structural path stays attached to the
      // `MIGRATION.NO_INVARIANT_PATH` error envelope. Using an empty
      // string here would leave the structural lookup with a hash that
      // is never a graph node, producing an empty `structuralPath` and
      // a less actionable diagnostic.
      const fromHash = liveMarker?.storageHash ?? EMPTY_CONTRACT_HASH;
      const structural = findPathWithDecision(targetMember.graph(), fromHash, targetHash, {
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
        ...(isAppMember && refName !== undefined ? { refName } : {}),
        required: targetInvariants,
        missing: walked.missing,
        structuralPath,
      });
    }

    perSpacePlans.set(member.spaceId, walked.result);
  }

  const canonicalOrder = [...aggregate.extensions.map((m) => m.spaceId), aggregate.app.spaceId];
  const applyOrder = canonicalOrder.filter((spaceId) => perSpacePlans.has(spaceId));

  // Short-circuit: nothing pending across any space (no runner-bound
  // plans). Surfaces every loaded member — including at-head empty-
  // graph extensions — in `perSpace[]` so the result reflects the
  // full aggregate, not just the spaces the runner would have touched.
  const totalPlannedOps = sumPlannedOps(applyOrder, perSpacePlans);
  if (totalPlannedOps === 0) {
    const ordered = canonicalOrder
      .filter((spaceId) => perSpacePlans.has(spaceId) || atHeadResolutions.has(spaceId))
      .map((spaceId) => {
        const entry = perSpacePlans.get(spaceId) ?? atHeadResolutions.get(spaceId);
        if (entry === undefined) {
          throw new Error(`Unreachable: missing per-space plan for "${spaceId}"`);
        }
        return { spaceId, entry };
      });
    const perSpace = buildPerSpaceBreakdown(ordered, aggregate.app.spaceId, {
      includeMarkers: true,
    });
    const totalSpaces = ordered.length;
    return ok(
      buildSuccess({
        aggregate,
        orderedResolutions: ordered,
        perSpace,
        totalOpsExecuted: 0,
        summary:
          totalSpaces === 0
            ? 'Already up to date — no contract spaces are loaded'
            : totalSpaces === 1
              ? 'Already up to date'
              : `Already up to date across ${totalSpaces} space(s)`,
      }),
    );
  }

  const applied = await runMigration({
    aggregate,
    perSpacePlans,
    applyOrder,
    driver,
    familyInstance,
    migrations,
    frameworkComponents,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
    action: 'migrate',
    ...ifDefined('onProgress', onProgress),
  });

  if (!applied.ok) {
    const failure: MigrateFailure = {
      code: 'RUNNER_FAILED',
      summary: applied.failure.summary,
      why: applied.failure.why,
      meta: applied.failure.meta,
    };
    return notOk(failure);
  }

  // Merge at-head zero-op resolutions back into the canonical order
  // so the success envelope surfaces every loaded member, not just
  // those the runner executed.
  const orderedAll = canonicalOrder
    .filter((spaceId) => perSpacePlans.has(spaceId) || atHeadResolutions.has(spaceId))
    .map((spaceId) => {
      if (perSpacePlans.has(spaceId)) {
        const fromRunner = applied.value.orderedResolutions.find((r) => r.spaceId === spaceId);
        if (fromRunner !== undefined) return fromRunner;
      }
      const entry = atHeadResolutions.get(spaceId);
      if (entry === undefined) {
        throw new Error(`Unreachable: missing per-space plan for "${spaceId}"`);
      }
      return { spaceId, entry };
    });
  const perSpaceAll = buildPerSpaceBreakdown(orderedAll, aggregate.app.spaceId, {
    includeMarkers: true,
  });
  const totalMigrationsApplied = applied.value.orderedResolutions.reduce(
    (sum, r) => sum + r.entry.migrationEdges.length,
    0,
  );
  const summary = `Applied ${totalMigrationsApplied} migration(s) (${applied.value.totalOpsExecuted} operation(s)) across ${orderedAll.length} contract space(s)`;

  return ok(
    buildSuccess({
      aggregate,
      orderedResolutions: orderedAll,
      perSpace: perSpaceAll,
      totalOpsExecuted: applied.value.totalOpsExecuted,
      summary,
    }),
  );
}

/**
 * Build a zero-op {@link PerSpacePlan} for an empty-graph
 * member whose live marker already matches the target. Lets the apply
 * pipeline thread the member through `perSpacePlans` -> `applyOrder`
 * -> the success envelope's `perSpace[]` block so the result reflects
 * every loaded space, even when there is nothing to execute.
 */
function buildAtHeadResolution(args: {
  readonly aggregateTargetId: string;
  readonly member: ContractSpaceMember;
  readonly targetHash: string;
  readonly liveMarker: ContractMarkerRecordLike | null;
}): PerSpacePlan {
  const { aggregateTargetId, member, targetHash, liveMarker } = args;
  return {
    plan: {
      targetId: aggregateTargetId,
      spaceId: member.spaceId,
      origin: liveMarker === null ? null : { storageHash: liveMarker.storageHash },
      destination: { storageHash: targetHash },
      operations: [],
      providedInvariants: [],
    },
    displayOps: [],
    destinationContract: member.contract(),
    strategy: 'graph-walk',
    migrationEdges: [
      buildSynthMigrationEdge({
        currentMarkerStorageHash: liveMarker?.storageHash,
        destinationStorageHash: targetHash,
        operationCount: 0,
      }),
    ],
  };
}

function sumPlannedOps(
  applyOrder: readonly string[],
  perSpacePlans: ReadonlyMap<string, PerSpacePlan>,
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
    readonly entry: PerSpacePlan;
  }>;
  readonly perSpace: ReadonlyArray<PerSpaceExecutionEntry>;
  readonly totalOpsExecuted: number;
  readonly summary: string;
}

function buildSuccess(args: BuildSuccessArgs): MigrateSuccess {
  // The marker hash surfaced at the top level is the **app member's**
  // post-migrate marker (the top-level `markerHash` field).
  // Per-space markers live on `perSpace[].marker.storageHash`.
  const appResolution = args.orderedResolutions.find(
    (r) => r.spaceId === args.aggregate.app.spaceId,
  );
  const appMarkerHash =
    appResolution?.entry.plan.destination.storageHash ?? requireHeadRef(args.aggregate.app).hash;

  // Per-migration entries (one per authored edge) preserve the
  // `migrationsApplied` count semantics for back-compat with existing
  // JSON-shape consumers (e.g. `parsed.applied.length` in integration
  // tests). The aggregate per-space breakdown lives on `perSpace[]`.
  const applied = args.orderedResolutions.flatMap((r) => {
    const edges = r.entry.migrationEdges;
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
  const pathDecision: MigratePathDecision | undefined = appPlan?.pathDecision
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

/**
 * Build the `neverPlanned` failure raised when a contract space has no on-disk
 * migration graph but migrate was asked to reach a target hash. The `why`
 * states only the condition; the recovery sequence is composed by
 * `errorPathUnreachable`'s `fix`.
 *
 * @internal Exported for testing only.
 */
export function buildNeverPlannedFailure(spaceId: string, targetHash: string): MigrateFailure {
  return {
    code: 'MIGRATION_PATH_NOT_FOUND',
    summary: `No on-disk migrations for contract space "${spaceId}"`,
    why: `migrate is replay-only: every contract space must have an authored migration graph on disk. Space "${spaceId}" has no migrations under \`migrations/${spaceId}/\` but its head ref targets "${targetHash}".`,
    meta: { spaceId, target: targetHash, kind: 'neverPlanned' },
  };
}

/**
 * Build the `pathUnreachable` failure raised when an emitted contract has no
 * on-disk migration edge from the current marker to the target. The `why`
 * states only the condition (no edge between the two named states, and migrate
 * replays edges rather than inventing them); the recovery sequence — plan the
 * edge, then re-apply — is composed by `errorPathUnreachable`'s `fix`, so the
 * two read as one non-redundant plan-then-apply story.
 *
 * @internal Exported for testing only.
 */
export function buildPathNotFoundFailure(
  spaceId: string,
  marker: ContractMarkerRecordLike | null,
  targetHash: string,
): MigrateFailure {
  const fromHash = marker?.storageHash ?? '<empty>';
  // The app-case phrasing names the user-visible condition (a
  // contract has been emitted that no on-disk migration reaches) so
  // the error reads naturally for the app member. Extension spaces
  // see the same condition expressed against the offending space.
  const summary =
    spaceId === 'app'
      ? 'Current contract has no planned migration path'
      : `Current contract has no planned migration path for contract space "${spaceId}"`;
  return {
    code: 'MIGRATION_PATH_NOT_FOUND',
    summary,
    why: `No migration edge connects the current state "${fromHash}" to the target "${targetHash}" in contract space "${spaceId}". The on-disk migration graph does not join the two, and migrate replays existing edges — it never invents one.`,
    meta: { spaceId, fromHash, targetHash, kind: 'pathUnreachable' },
  };
}
