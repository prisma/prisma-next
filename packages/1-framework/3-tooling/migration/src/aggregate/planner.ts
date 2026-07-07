import { notOk, ok } from '@prisma-next/utils/result';
import { requireHeadRef } from './aggregate';
import type { PerSpacePlan, PlannerError, PlannerInput, PlannerOutput } from './planner-types';
import { graphWalkStrategy } from './strategies/graph-walk';
import { synthStrategy } from './strategies/synth';
import type { AggregateContractSpace } from './types';

export type {
  AggregateCurrentDBState,
  AggregateMigrationEdgeRef,
  CallerPolicy,
  PerSpacePlan,
  PlannerError,
  PlannerInput,
  PlannerOutput,
  PlannerSuccess,
} from './planner-types';

/**
 * Plan a migration across every contract space of a {@link ContractSpaceAggregate}.
 *
 * Strategy selection per contract space, in order; first match wins:
 *
 * 1. If `callerPolicy.ignoreGraphFor.has(space.spaceId)`:
 *    - If `space.headRef.invariants` is empty → synth.
 *    - Else → `policyConflict` (synth cannot satisfy authored invariants).
 * 2. Else if `space.graph()` is non-empty AND graph-walk
 *    succeeds → graph-walk.
 * 3. Else if `space.headRef.invariants` is empty → synth.
 * 4. Else → graph-walk failure → `extensionPathUnreachable` /
 *    `extensionPathUnsatisfiable`.
 *
 * Output `applyOrder` is `[...aggregate.extensions.map(spaceId), aggregate.app.spaceId]`
 * — extensions alphabetical, then app — matching today's
 * `concatenateSpaceApplyInputs` ordering. This preserves
 * `MigrationRunnerFailure.failingSpace` attribution byte-for-byte.
 *
 * Every emitted `MigrationPlan` has `targetId = aggregate.targetId`.
 * No placeholder cast; no patch step.
 */
export async function planMigration<TFamilyId extends string, TTargetId extends string>(
  input: PlannerInput<TFamilyId, TTargetId>,
): Promise<PlannerOutput> {
  const { aggregate, currentDBState, callerPolicy } = input;

  const perSpace = new Map<string, PerSpacePlan>();

  // Iterate in apply order so a per-space error short-circuits the
  // walk in the same order the runner would walk inputs.
  const orderedSpaces: ReadonlyArray<AggregateContractSpace> = [
    ...aggregate.extensions,
    aggregate.app,
  ];

  for (const space of orderedSpaces) {
    const declaredByAnotherSpace = (entityName: string): boolean =>
      aggregate.declaringSpaces(entityName).some((spaceId) => spaceId !== space.spaceId);
    const currentMarker = currentDBState.markersBySpaceId.get(space.spaceId) ?? null;
    const headRef = requireHeadRef(space);

    const ignoreGraph = callerPolicy.ignoreGraphFor.has(space.spaceId);
    const invariantsRequired = headRef.invariants.length > 0;

    if (ignoreGraph && invariantsRequired) {
      const conflict: PlannerError = {
        kind: 'policyConflict',
        spaceId: space.spaceId,
        detail: `\`callerPolicy.ignoreGraphFor\` requested for space "${space.spaceId}", but the contract space declares non-empty head-ref invariants (${headRef.invariants.join(', ')}). Synthesising a plan from the contract IR cannot satisfy authored invariants — the graph must be walked. Either remove "${space.spaceId}" from \`ignoreGraphFor\` or amend the on-disk head ref to declare zero invariants.`,
      };
      return notOk(conflict);
    }

    if (ignoreGraph) {
      const synthOutcome = await synthStrategy({
        aggregateTargetId: aggregate.targetId,
        currentMarker,
        space,
        declaredByAnotherSpace,
        schemaIntrospection: currentDBState.schemaIntrospection,
        adapter: input.adapter,
        migrations: input.migrations,
        frameworkComponents: input.frameworkComponents,
        operationPolicy: input.operationPolicy,
      });
      if (synthOutcome.kind === 'failure') {
        return notOk({
          kind: 'appSynthFailure',
          spaceId: space.spaceId,
          conflicts: synthOutcome.conflicts,
        });
      }
      perSpace.set(space.spaceId, synthOutcome.result);
      continue;
    }

    // Try graph-walk first when the graph has nodes; fall back to synth
    // when the graph is empty AND no invariants are required.
    if (space.graph().nodes.size > 0) {
      const walked = graphWalkStrategy({
        aggregateTargetId: aggregate.targetId,
        space,
        currentMarker,
      });
      if (walked.kind === 'ok') {
        perSpace.set(space.spaceId, walked.result);
        continue;
      }
      if (walked.kind === 'unreachable') {
        return notOk({
          kind: 'extensionPathUnreachable',
          spaceId: space.spaceId,
          target: headRef.hash,
        });
      }
      // unsatisfiable — surface
      return notOk({
        kind: 'extensionPathUnsatisfiable',
        spaceId: space.spaceId,
        missingInvariants: walked.missing,
      });
    }

    // Empty graph: synth is the only option, and it can only satisfy
    // empty-invariant contract spaces.
    if (invariantsRequired) {
      return notOk({
        kind: 'extensionPathUnsatisfiable',
        spaceId: space.spaceId,
        missingInvariants: [...headRef.invariants].sort(),
      });
    }

    const synthOutcome = await synthStrategy({
      aggregateTargetId: aggregate.targetId,
      currentMarker,
      space,
      declaredByAnotherSpace,
      schemaIntrospection: currentDBState.schemaIntrospection,
      adapter: input.adapter,
      migrations: input.migrations,
      frameworkComponents: input.frameworkComponents,
      operationPolicy: input.operationPolicy,
    });
    if (synthOutcome.kind === 'failure') {
      return notOk({
        kind: 'appSynthFailure',
        spaceId: space.spaceId,
        conflicts: synthOutcome.conflicts,
      });
    }
    perSpace.set(space.spaceId, synthOutcome.result);
  }

  return ok({
    perSpace,
    applyOrder: [...aggregate.extensions.map((m) => m.spaceId), aggregate.app.spaceId],
  });
}
