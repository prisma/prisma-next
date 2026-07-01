import { elementCoordinates } from '@prisma-next/framework-components/ir';
import type { Result } from '@prisma-next/utils/result';
import { notOk, ok } from '@prisma-next/utils/result';
import { requireHeadRef } from './aggregate';
import type { ContractMarkerRecordLike } from './marker-types';
import {
  type ListSchemaEntityNames,
  type ProjectSchemaToMember,
  projectSchemaToSpace,
} from './project-schema-to-space';
import type { ContractSpaceAggregate, ContractSpaceMember } from './types';

/**
 * Caller policy for the verifier. Today's only knob is
 * `mode`: `strict` treats orphan elements (live tables not claimed by
 * any aggregate member) as errors; `lenient` treats them as
 * informational. Maps directly to `db verify --strict`.
 */
export interface VerifierInput<TSchemaResult> {
  readonly aggregate: ContractSpaceAggregate;
  readonly markersBySpaceId: ReadonlyMap<string, ContractMarkerRecordLike | null>;
  readonly schemaIntrospection: unknown;
  readonly mode: 'strict' | 'lenient';
  /**
   * Caller-supplied per-space schema verifier. The CLI wires this to
   * the family's `verifySqlSchema` (SQL) / equivalent (other
   * families). The verifier projects the schema to the
   * member's slice via {@link projectSchemaToSpace} before invoking
   * the callback, so single-contract semantics are preserved.
   *
   * Typed structurally with a generic `TSchemaResult` so the
   * migration-tools layer doesn't depend on the SQL family's
   * `VerifySqlSchemaResult`. CLI callers pass the family's type
   * through unchanged.
   */
  readonly verifySchemaForMember: (
    projectedSchema: unknown,
    member: ContractSpaceMember,
    mode: 'strict' | 'lenient',
  ) => TSchemaResult;
  /**
   * Caller-supplied schema-shape callbacks. The framework touches no storage
   * shape: `projectSchemaToMember` prunes the live schema to a member's slice,
   * and `listEntityNames` enumerates the live entity names for orphan
   * detection. The families provide both (each knows how its own introspected
   * schema is shaped); the CLI wires them.
   */
  readonly projectSchemaToMember: ProjectSchemaToMember;
  readonly listEntityNames: ListSchemaEntityNames;
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

/**
 * A live storage element (today: a top-level table) not claimed by any
 * member of the aggregate. The verifier always reports these;
 * the caller decides what to do — `db verify --strict` treats them as
 * errors, the lenient default treats them as informational.
 *
 * Today only `kind: 'table'` exists. The discriminated shape leaves
 * room for orphan columns / indexes / sequences in the future without
 * breaking the type contract.
 */
export type OrphanElement = { readonly kind: 'table'; readonly name: string };

export interface SchemaCheckSection<TSchemaResult> {
  readonly perSpace: ReadonlyMap<string, TSchemaResult>;
  /**
   * Live elements present in the introspected schema that are not
   * claimed by **any** aggregate member. Sorted alphabetically by name.
   */
  readonly orphanElements: readonly OrphanElement[];
}

export interface VerifierSuccess<TSchemaResult> {
  readonly markerCheck: MarkerCheckSection;
  readonly schemaCheck: SchemaCheckSection<TSchemaResult>;
}

export type VerifierError = {
  readonly kind: 'introspectionFailure';
  readonly detail: string;
};

export type VerifierOutput<TSchemaResult> = Result<VerifierSuccess<TSchemaResult>, VerifierError>;

/**
 * Verify a {@link ContractSpaceAggregate} against the live database
 * state. Bundles two checks:
 *
 * - `markerCheck` per member: compare the live marker row against the
 *   member's `headRef.hash` + `headRef.invariants`. Absence is a
 *   distinct kind, not an error (callers — `db verify` strict vs
 *   `db init` precondition — choose how to interpret it).
 * - `schemaCheck` per member: project the live schema to the slice
 *   the member claims via {@link projectSchemaToSpace}, then delegate
 *   to the caller-supplied `verifySchemaForMember`. The pre-projection
 *   means the family's single-contract verifier no longer sees other
 *   members' tables as `extras`, so a multi-member deployment never
 *   surfaces cross-member tables as orphaned schema elements.
 *
 * `markerCheck.orphanMarkers` lists every marker row whose `space` is
 * not a member of the aggregate. `db verify` callers reject orphans;
 * future tooling may not.
 *
 * Pure synchronous function; no I/O. The caller (CLI) gathers
 * `markersBySpaceId` and `schemaIntrospection` ahead of the call.
 */
export function verifyMigration<TSchemaResult>(
  input: VerifierInput<TSchemaResult>,
): VerifierOutput<TSchemaResult> {
  try {
    return runVerifyMigration(input);
  } catch (error) {
    return notOk({
      kind: 'introspectionFailure',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function runVerifyMigration<TSchemaResult>(
  input: VerifierInput<TSchemaResult>,
): VerifierOutput<TSchemaResult> {
  const {
    aggregate,
    markersBySpaceId,
    schemaIntrospection,
    mode,
    verifySchemaForMember,
    projectSchemaToMember,
    listEntityNames,
  } = input;
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

  // Schema check per member (with per-space pre-projection).
  const schemaPerSpace = new Map<string, TSchemaResult>();
  for (const member of allMembers) {
    const others = allMembers.filter((m) => m.spaceId !== member.spaceId);
    const projected = projectSchemaToSpace(
      schemaIntrospection,
      member,
      others,
      projectSchemaToMember,
    );
    schemaPerSpace.set(member.spaceId, verifySchemaForMember(projected, member, mode));
  }

  return ok({
    markerCheck: {
      perSpace: markerPerSpace,
      orphanMarkers,
    },
    schemaCheck: {
      perSpace: schemaPerSpace,
      orphanElements: detectOrphanElements(schemaIntrospection, allMembers, listEntityNames),
    },
  });
}

/**
 * Live entities not claimed by any aggregate member. The live entity names come
 * from the family-provided {@link ListSchemaEntityNames} callback; the claimed
 * names come from each member's contract storage via {@link elementCoordinates}
 * (target-agnostic). The framework never inspects the schema shape.
 */
function detectOrphanElements(
  schemaIntrospection: unknown,
  members: ReadonlyArray<ContractSpaceMember>,
  listEntityNames: ListSchemaEntityNames,
): readonly OrphanElement[] {
  const liveTableNames = listEntityNames(schemaIntrospection);
  if (liveTableNames.length === 0) return [];

  const claimedTables = new Set<string>();
  for (const member of members) {
    const contract = member.contract();
    for (const { entityName } of elementCoordinates(contract.storage)) {
      claimedTables.add(entityName);
    }
  }

  const orphans: OrphanElement[] = [];
  for (const tableName of liveTableNames) {
    if (!claimedTables.has(tableName)) {
      orphans.push({ kind: 'table', name: tableName });
    }
  }
  orphans.sort((a, b) => a.name.localeCompare(b.name));
  return orphans;
}
