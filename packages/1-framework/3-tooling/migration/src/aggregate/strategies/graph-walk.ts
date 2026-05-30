import type { MigrationPlan } from '@prisma-next/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '../../constants';
import { findPathWithDecision } from '../../migration-graph';
import type { MigrationOps, OnDiskMigrationPackage } from '../../package';
import { requireHeadRef } from '../aggregate';
import type { ContractMarkerRecordLike } from '../marker-types';
import type { AggregatePerSpacePlan } from '../planner-types';
import type { ContractSpaceMember } from '../types';

/**
 * Outcome variants for the graph-walk strategy. Mirrors
 * {@link import('../../compute-extension-space-apply-path').ExtensionSpaceApplyPathOutcome}
 * but operates against the member's lazily-reconstructed `graph()`
 * instead of re-reading from disk. The aggregate planner converts
 * these into {@link import('../planner-types').AggregatePlannerError}
 * variants.
 */
export type GraphWalkOutcome =
  | { readonly kind: 'ok'; readonly result: AggregatePerSpacePlan }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'unsatisfiable'; readonly missing: readonly string[] };

export interface GraphWalkStrategyInputs {
  readonly aggregateTargetId: string;
  readonly member: ContractSpaceMember;
  readonly currentMarker: ContractMarkerRecordLike | null;
  /**
   * Optional ref name to decorate the resulting `PathDecision`. Used by
   * `migrate` to surface the user-supplied `--to <name>` in
   * structured-progress events and invariant-path error envelopes. The
   * strategy itself does not interpret it.
   */
  readonly refName?: string;
}

/**
 * Walk a member's hydrated migration graph from the live marker to
 * `member.headRef.hash`, covering every required invariant.
 *
 * Pure synchronous function — no I/O. The aggregate's loader has
 * already integrity-checked every package and reconstructed the graph;
 * this strategy just looks up ops by `migrationHash` and assembles a
 * `MigrationPlan` with `targetId` set from the aggregate (no
 * placeholder cast).
 *
 * Required invariants are computed as `headRef.invariants \ marker.invariants`
 * — the marker already declares some invariants satisfied; the path
 * only needs to provide the remainder. Mirrors today's
 * `computeExtensionSpaceApplyPath` semantics.
 */
export function graphWalkStrategy(input: GraphWalkStrategyInputs): GraphWalkOutcome {
  const { aggregateTargetId, member, currentMarker, refName } = input;
  const headRef = requireHeadRef(member);
  const graph = member.graph();
  const packagesByMigrationHash = new Map<string, OnDiskMigrationPackage>(
    member.packages.map((pkg) => [pkg.metadata.migrationHash, pkg]),
  );

  const fromHash = currentMarker?.storageHash ?? EMPTY_CONTRACT_HASH;
  const markerInvariants = new Set(currentMarker?.invariants ?? []);
  const required = new Set(headRef.invariants.filter((id) => !markerInvariants.has(id)));

  const outcome = findPathWithDecision(graph, fromHash, headRef.hash, {
    required,
    ...(refName !== undefined ? { refName } : {}),
  });

  if (outcome.kind === 'unreachable') {
    return { kind: 'unreachable' };
  }
  if (outcome.kind === 'unsatisfiable') {
    return { kind: 'unsatisfiable', missing: outcome.missing };
  }

  const pathOps: MigrationOps[number][] = [];
  const providedInvariantsSet = new Set<string>();
  const edgeRefs: Array<{
    migrationHash: string;
    dirName: string;
    from: string;
    to: string;
    operationCount: number;
  }> = [];
  for (const edge of outcome.decision.selectedPath) {
    const pkg = packagesByMigrationHash.get(edge.migrationHash);
    if (!pkg) {
      throw new Error(
        `Migration package missing for edge ${edge.migrationHash} in space "${member.spaceId}". The hydrated migration graph and packagesByMigrationHash map are out of sync — this should be unreachable; report.`,
      );
    }
    for (const op of pkg.ops) pathOps.push(op);
    for (const invariant of pkg.metadata.providedInvariants) providedInvariantsSet.add(invariant);
    edgeRefs.push({
      migrationHash: edge.migrationHash,
      dirName: edge.dirName,
      from: edge.from,
      to: edge.to,
      operationCount: pkg.ops.length,
    });
  }

  const plan: MigrationPlan = {
    targetId: aggregateTargetId,
    spaceId: member.spaceId,
    origin: currentMarker === null ? null : { storageHash: currentMarker.storageHash },
    destination: { storageHash: headRef.hash },
    operations: pathOps,
    providedInvariants: [...providedInvariantsSet].sort(),
  };

  return {
    kind: 'ok',
    result: {
      plan,
      displayOps: pathOps,
      destinationContract: member.contract(),
      strategy: 'graph-walk',
      migrationEdges: edgeRefs,
      pathDecision: outcome.decision,
    },
  };
}
