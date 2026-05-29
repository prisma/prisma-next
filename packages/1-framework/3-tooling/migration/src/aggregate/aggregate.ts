import type { Contract } from '@prisma-next/contract/types';
import type { MigrationGraph } from '../graph';
import type { IntegrityQueryOptions, IntegrityViolation } from '../integrity-violation';
import { reconstructGraph } from '../migration-graph';
import type { OnDiskMigrationPackage } from '../package';
import type { Refs } from '../refs';
import type { ContractSpaceHeadRecord } from '../verify-contract-spaces';
import type { ContractSpaceAggregate, ContractSpaceMember } from './types';

/**
 * Resolve a member's head ref, asserting it is present. The apply/verify
 * engine only runs after `checkIntegrity` has refused on `headRefMissing`,
 * so a member reaching the planner / verifier without a head ref is a
 * programming error (the integrity gate was skipped), not a user-facing
 * state. The app member's head ref is always synthesised, so this only
 * ever guards an ungated extension space.
 */
export function requireHeadRef(member: ContractSpaceMember): ContractSpaceHeadRecord {
  if (member.headRef === null) {
    throw new Error(
      `Contract space "${member.spaceId}" has no head ref; the integrity gate must refuse a missing head ref before planning or verifying.`,
    );
  }
  return member.headRef;
}

/**
 * Build a {@link ContractSpaceMember} with lazily-memoised `graph()` and
 * `contract()` facets.
 *
 * `graph()` reconstructs the migration graph from `packages` on first
 * call and caches it. `contract()` calls `resolveContract` on first call
 * and caches the result; a throwing `resolveContract` (e.g. a missing or
 * undeserializable on-disk contract) re-throws on each call rather than
 * caching a value — `checkIntegrity` surfaces that as `contractUnreadable`.
 */
export function createContractSpaceMember(args: {
  readonly spaceId: string;
  readonly packages: readonly OnDiskMigrationPackage[];
  readonly refs: Refs;
  readonly headRef: ContractSpaceHeadRecord | null;
  readonly resolveContract: () => Contract;
}): ContractSpaceMember {
  const { spaceId, packages, refs, headRef, resolveContract } = args;
  let graphMemo: MigrationGraph | undefined;
  let contractMemo: Contract | undefined;
  return {
    spaceId,
    packages,
    refs,
    headRef,
    graph() {
      graphMemo ??= reconstructGraph(packages);
      return graphMemo;
    },
    contract() {
      contractMemo ??= resolveContract();
      return contractMemo;
    },
  };
}

/**
 * Assemble a {@link ContractSpaceAggregate} value from its members and a
 * `checkIntegrity` implementation. The query methods (`listSpaces` /
 * `hasSpace` / `space` / `spaces`) are derived here so every aggregate —
 * loader-built or test-built — shares one query surface: `app` first,
 * then `extensions` in the order supplied (the loader sorts them
 * lex-ascending by `spaceId`).
 */
export function createContractSpaceAggregate(args: {
  readonly targetId: string;
  readonly app: ContractSpaceMember;
  readonly extensions: readonly ContractSpaceMember[];
  readonly checkIntegrity: (opts?: IntegrityQueryOptions) => readonly IntegrityViolation[];
}): ContractSpaceAggregate {
  const { targetId, app, extensions, checkIntegrity } = args;
  const ordered: readonly ContractSpaceMember[] = [app, ...extensions];
  const byId = new Map(ordered.map((m) => [m.spaceId, m]));
  return {
    targetId,
    app,
    extensions,
    listSpaces: () => ordered.map((m) => m.spaceId),
    hasSpace: (id) => byId.has(id),
    space: (id) => byId.get(id),
    spaces: () => ordered,
    checkIntegrity,
  };
}
