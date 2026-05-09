import type { Contract } from '@prisma-next/contract/types';
import type { MigrationPlan } from '@prisma-next/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '../../constants';
import { findPathWithDecision } from '../../migration-graph';
import type { MigrationOps } from '../../package';
import type { ContractMarkerRecordLike } from '../marker-types';
import type { AggregatePerSpacePlan } from '../planner-types';
import type { ContractSpaceMember } from '../types';

/**
 * Outcome variants for the graph-walk strategy. Mirrors
 * {@link import('../../compute-extension-space-apply-path').ExtensionSpaceApplyPathOutcome}
 * but operates against the **already-hydrated** `member.migrations.graph`
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
  const { aggregateTargetId, member, currentMarker } = input;
  const { graph, packagesByMigrationHash } = member.migrations;

  const fromHash = currentMarker?.storageHash ?? EMPTY_CONTRACT_HASH;
  const markerInvariants = new Set(currentMarker?.invariants ?? []);
  const required = new Set(member.headRef.invariants.filter((id) => !markerInvariants.has(id)));

  const outcome = findPathWithDecision(graph, fromHash, member.headRef.hash, { required });

  if (outcome.kind === 'unreachable') {
    return { kind: 'unreachable' };
  }
  if (outcome.kind === 'unsatisfiable') {
    return { kind: 'unsatisfiable', missing: outcome.missing };
  }

  const pathOps: MigrationOps[number][] = [];
  const providedInvariantsSet = new Set<string>();
  for (const edge of outcome.decision.selectedPath) {
    const pkg = packagesByMigrationHash.get(edge.migrationHash);
    if (!pkg) {
      throw new Error(
        `Migration package missing for edge ${edge.migrationHash} in space "${member.spaceId}". The hydrated migration graph and packagesByMigrationHash map are out of sync — this should be unreachable; report.`,
      );
    }
    for (const op of pkg.ops) pathOps.push(op);
    for (const invariant of pkg.metadata.providedInvariants) providedInvariantsSet.add(invariant);
  }

  const plan: MigrationPlan = {
    targetId: aggregateTargetId,
    origin: currentMarker === null ? null : { storageHash: currentMarker.storageHash },
    destination: { storageHash: member.headRef.hash },
    operations: pathOps,
    providedInvariants: [...providedInvariantsSet].sort(),
  };

  return {
    kind: 'ok',
    result: {
      plan,
      displayOps: pathOps,
      destinationContract: member.contract as Contract,
      strategy: 'graph-walk',
    },
  };
}
