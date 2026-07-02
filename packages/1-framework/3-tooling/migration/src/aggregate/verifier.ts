import type { VerifyDatabaseSchemaResult } from '@prisma-next/framework-components/control';
import type { Result } from '@prisma-next/utils/result';
import { notOk, ok } from '@prisma-next/utils/result';
import { requireHeadRef } from './aggregate';
import type { ContractMarkerRecordLike } from './marker-types';
import { otherMemberEntityNames, scopeSchemaResultToSpace } from './scope-schema-result';
import type { ContractSpaceAggregate, ContractSpaceMember } from './types';

/**
 * Caller policy for the verifier. Today's only knob is
 * `mode`: `strict` treats orphan elements (live tables not claimed by
 * any aggregate member) as errors; `lenient` treats them as
 * informational. Maps directly to `db verify --strict`.
 */
export interface VerifierInput {
  readonly aggregate: ContractSpaceAggregate;
  readonly markersBySpaceId: ReadonlyMap<string, ContractMarkerRecordLike | null>;
  readonly schemaIntrospection: unknown;
  readonly mode: 'strict' | 'lenient';
  /**
   * Caller-supplied per-space schema verifier. The CLI wires this to the
   * family's `verifySchema`. It verifies the member against the **full**
   * introspected schema; the verifier then scopes the result to the member's
   * contract space (dropping the extras other members claim). It composes no
   * pre-projection, so the framework never touches the storage shape.
   */
  readonly verifySchemaForMember: (
    schema: unknown,
    member: ContractSpaceMember,
    mode: 'strict' | 'lenient',
  ) => VerifyDatabaseSchemaResult;
}

/**
 * Marker-check result per member. Mirrors the four cases the
 * `verifyContractSpaces` primitive surfaces today, plus an `'absent'`
 * case for greenfield spaces (no marker row written yet — `db init`
 * not run).
 */
export type MarkerCheckResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'hashMismatch';
      readonly markerHash: string;
      readonly expected: string;
    }
  | { readonly kind: 'missingInvariants'; readonly missing: readonly string[] };

export interface MarkerCheckSection {
  readonly perSpace: ReadonlyMap<string, MarkerCheckResult>;
  readonly orphanMarkers: readonly {
    readonly spaceId: string;
    readonly row: ContractMarkerRecordLike;
  }[];
}

export interface SchemaCheckSection {
  readonly perSpace: ReadonlyMap<string, VerifyDatabaseSchemaResult>;
}

export interface VerifierSuccess {
  readonly markerCheck: MarkerCheckSection;
  readonly schemaCheck: SchemaCheckSection;
}

export type VerifierError = {
  readonly kind: 'introspectionFailure';
  readonly detail: string;
};

export type VerifierOutput = Result<VerifierSuccess, VerifierError>;

/**
 * Verify a {@link ContractSpaceAggregate} against the live database
 * state. Bundles two checks:
 *
 * - `markerCheck` per member: compare the live marker row against the
 *   member's `headRef.hash` + `headRef.invariants`. Absence is a
 *   distinct kind, not an error (callers — `db verify` strict vs
 *   `db init` precondition — choose how to interpret it).
 * - `schemaCheck` per member: verify the member against the **full**
 *   introspected schema, then scope the result to the member's contract
 *   space via {@link scopeSchemaResultToSpace} — dropping the extras every
 *   other member claims. Extras owned by no member survive as each member's
 *   undeclared-table findings. No schema is pruned before verifying.
 *
 * `markerCheck.orphanMarkers` lists every marker row whose `space` is
 * not a member of the aggregate. `db verify` callers reject orphans;
 * future tooling may not.
 *
 * Pure synchronous function; no I/O. The caller (CLI) gathers
 * `markersBySpaceId` and `schemaIntrospection` ahead of the call.
 */
export function verifyMigration(input: VerifierInput): VerifierOutput {
  try {
    return runVerifyMigration(input);
  } catch (error) {
    return notOk({
      kind: 'introspectionFailure',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function runVerifyMigration(input: VerifierInput): VerifierOutput {
  const { aggregate, markersBySpaceId, schemaIntrospection, mode, verifySchemaForMember } = input;
  const allMembers: ReadonlyArray<ContractSpaceMember> = [aggregate.app, ...aggregate.extensions];
  const memberSpaceIds = new Set(allMembers.map((m) => m.spaceId));

  // Marker check per member.
  const markerPerSpace = new Map<string, MarkerCheckResult>();
  for (const member of allMembers) {
    const marker = markersBySpaceId.get(member.spaceId) ?? null;
    if (marker === null) {
      markerPerSpace.set(member.spaceId, { kind: 'absent' });
      continue;
    }
    const headRef = requireHeadRef(member);
    if (marker.storageHash !== headRef.hash) {
      markerPerSpace.set(member.spaceId, {
        kind: 'hashMismatch',
        markerHash: marker.storageHash,
        expected: headRef.hash,
      });
      continue;
    }
    const markerInvariants = new Set(marker.invariants);
    const missing = headRef.invariants.filter((id) => !markerInvariants.has(id));
    if (missing.length > 0) {
      markerPerSpace.set(member.spaceId, {
        kind: 'missingInvariants',
        missing: [...missing].sort(),
      });
      continue;
    }
    markerPerSpace.set(member.spaceId, { kind: 'ok' });
  }

  // Orphan markers: entries in markersBySpaceId whose spaceId is not a
  // member of the aggregate.
  const orphanMarkers: { spaceId: string; row: ContractMarkerRecordLike }[] = [];
  for (const [spaceId, row] of markersBySpaceId) {
    if (row !== null && !memberSpaceIds.has(spaceId)) {
      orphanMarkers.push({ spaceId, row });
    }
  }
  orphanMarkers.sort((a, b) => a.spaceId.localeCompare(b.spaceId));

  // Schema check per member: verify against the full schema, then scope the
  // result to the member's contract space.
  const schemaPerSpace = new Map<string, VerifyDatabaseSchemaResult>();
  for (const member of allMembers) {
    const others = allMembers.filter((m) => m.spaceId !== member.spaceId);
    const result = verifySchemaForMember(schemaIntrospection, member, mode);
    schemaPerSpace.set(
      member.spaceId,
      scopeSchemaResultToSpace(result, otherMemberEntityNames(member, others)),
    );
  }

  return ok({
    markerCheck: {
      perSpace: markerPerSpace,
      orphanMarkers,
    },
    schemaCheck: {
      perSpace: schemaPerSpace,
    },
  });
}
