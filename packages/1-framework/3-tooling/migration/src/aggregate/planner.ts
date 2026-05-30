import { notOk, ok } from '@prisma-next/utils/result';
import { requireHeadRef } from './aggregate';
import type {
  AggregatePerSpacePlan,
  AggregatePlannerError,
  AggregatePlannerInput,
  AggregatePlannerOutput,
} from './planner-types';
import { graphWalkStrategy } from './strategies/graph-walk';
import { synthStrategy } from './strategies/synth';
import type { ContractSpaceMember } from './types';

export type {
  AggregateCurrentDBState,
  AggregateMigrationEdgeRef,
  AggregatePerSpacePlan,
  AggregatePlannerError,
  AggregatePlannerInput,
  AggregatePlannerOutput,
  AggregatePlannerSuccess,
  CallerPolicy,
} from './planner-types';

/**
 * Plan a migration across every member of a {@link ContractSpaceAggregate}.
 *
 * Strategy selection per member, in order; first match wins:
 *
 * 1. If `callerPolicy.ignoreGraphFor.has(member.spaceId)`:
 *    - If `member.headRef.invariants` is empty → synth.
 *    - Else → `policyConflict` (synth cannot satisfy authored invariants).
 * 2. Else if `member.graph()` is non-empty AND graph-walk
 *    succeeds → graph-walk.
 * 3. Else if `member.headRef.invariants` is empty → synth.
 * 4. Else → graph-walk failure → `extensionPathUnreachable` /
 *    `extensionPathUnsatisfiable`.
 *
 * Output `applyOrder` is `[...aggregate.extensions.map(spaceId), aggregate.app.spaceId]`
 * — extensions alphabetical, then app — matching today's
 * `concatenateSpaceApplyInputs` ordering. This preserves
 * `MultiSpaceRunnerFailure.failingSpace` attribution byte-for-byte.
 *
 * Every emitted `MigrationPlan` has `targetId = aggregate.targetId`.
 * No placeholder cast; no patch step.
 */
export async function planAggregate<TFamilyId extends string, TTargetId extends string>(
  input: AggregatePlannerInput<TFamilyId, TTargetId>,
): Promise<AggregatePlannerOutput> {
  const { aggregate, currentDBState, callerPolicy } = input;
  const allMembers: ReadonlyArray<ContractSpaceMember> = [aggregate.app, ...aggregate.extensions];

  const perSpace = new Map<string, AggregatePerSpacePlan>();

  // Iterate in apply order so a per-member error short-circuits the
  // walk in the same order the runner would walk inputs.
  const orderedMembers: ReadonlyArray<ContractSpaceMember> = [
    ...aggregate.extensions,
    aggregate.app,
  ];

  for (const member of orderedMembers) {
    const otherMembers = allMembers.filter((m) => m.spaceId !== member.spaceId);
    const currentMarker = currentDBState.markersBySpaceId.get(member.spaceId) ?? null;
    const headRef = requireHeadRef(member);

    const ignoreGraph = callerPolicy.ignoreGraphFor.has(member.spaceId);
    const invariantsRequired = headRef.invariants.length > 0;

    if (ignoreGraph && invariantsRequired) {
      const conflict: AggregatePlannerError = {
        kind: 'policyConflict',
        spaceId: member.spaceId,
        detail: `\`callerPolicy.ignoreGraphFor\` requested for space "${member.spaceId}", but the member declares non-empty head-ref invariants (${headRef.invariants.join(', ')}). Synthesising a plan from the contract IR cannot satisfy authored invariants — the graph must be walked. Either remove "${member.spaceId}" from \`ignoreGraphFor\` or amend the on-disk head ref to declare zero invariants.`,
      };
      return notOk(conflict);
    }

    if (ignoreGraph) {
      const synthOutcome = await synthStrategy({
        aggregateTargetId: aggregate.targetId,
        member,
        otherMembers,
        schemaIntrospection: currentDBState.schemaIntrospection,
        familyInstance: input.familyInstance,
        migrations: input.migrations,
        frameworkComponents: input.frameworkComponents,
        operationPolicy: input.operationPolicy,
      });
      if (synthOutcome.kind === 'failure') {
        return notOk({
          kind: 'appSynthFailure',
          spaceId: member.spaceId,
          conflicts: synthOutcome.conflicts,
        });
      }
      perSpace.set(member.spaceId, synthOutcome.result);
      continue;
    }

    // Try graph-walk first when the graph has nodes; fall back to synth
    // when the graph is empty AND no invariants are required.
    if (member.graph().nodes.size > 0) {
      const walked = graphWalkStrategy({
        aggregateTargetId: aggregate.targetId,
        member,
        currentMarker,
      });
      if (walked.kind === 'ok') {
        perSpace.set(member.spaceId, walked.result);
        continue;
      }
      if (walked.kind === 'unreachable') {
        return notOk({
          kind: 'extensionPathUnreachable',
          spaceId: member.spaceId,
          target: headRef.hash,
        });
      }
      // unsatisfiable — surface
      return notOk({
        kind: 'extensionPathUnsatisfiable',
        spaceId: member.spaceId,
        missingInvariants: walked.missing,
      });
    }

    // Empty graph: synth is the only option, and it can only satisfy
    // empty-invariant members.
    if (invariantsRequired) {
      return notOk({
        kind: 'extensionPathUnsatisfiable',
        spaceId: member.spaceId,
        missingInvariants: [...headRef.invariants].sort(),
      });
    }

    const synthOutcome = await synthStrategy({
      aggregateTargetId: aggregate.targetId,
      member,
      otherMembers,
      schemaIntrospection: currentDBState.schemaIntrospection,
      familyInstance: input.familyInstance,
      migrations: input.migrations,
      frameworkComponents: input.frameworkComponents,
      operationPolicy: input.operationPolicy,
    });
    if (synthOutcome.kind === 'failure') {
      return notOk({
        kind: 'appSynthFailure',
        spaceId: member.spaceId,
        conflicts: synthOutcome.conflicts,
      });
    }
    perSpace.set(member.spaceId, synthOutcome.result);
  }

  return ok({
    perSpace,
    applyOrder: [...aggregate.extensions.map((m) => m.spaceId), aggregate.app.spaceId],
  });
}
