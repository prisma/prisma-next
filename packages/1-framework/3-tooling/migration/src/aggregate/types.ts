import type { Contract } from '@prisma-next/contract/types';
import type { MigrationGraph } from '../graph';
import type { IntegrityQueryOptions, IntegrityViolation } from '../integrity-violation';
import type { OnDiskMigrationPackage } from '../package';
import type { Refs } from '../refs';
import type { ContractSpaceHeadRecord } from '../verify-contract-spaces';

/**
 * One contract space — app or extension — as a member of a
 * {@link ContractSpaceAggregate}. Every member has the same shape.
 *
 * A member is a tolerant snapshot of one space's on-disk state, not a
 * validated value: `packages` is the raw migration-package list as read
 * from disk (a hash- or invariants-mismatched package is retained here;
 * a genuinely unparseable one is omitted), and integrity is judged
 * separately by {@link ContractSpaceAggregate.checkIntegrity}.
 *
 * - `spaceId`: `'app'` for the application, otherwise the extension's
 *   id (validated against `[a-z][a-z0-9_-]{0,63}`).
 * - `packages`: raw on-disk migration packages, as read; never
 *   integrity-validated at load.
 * - `refs`: the user-authored refs under `migrations/<spaceId>/refs/*.json`.
 * - `headRef`: the system head ref read from
 *   `migrations/<spaceId>/refs/head.json`, or `null` when absent
 *   (represented as a `headRefMissing` violation, never fatal). The app
 *   member's head ref is always synthesised from its live contract's
 *   storage hash, so it is never `null`.
 * - `graph()`: the migration graph this space's packages induce —
 *   lazily reconstructed on first call and memoised. Pure structure: a
 *   `from === to` self-edge is represented, not rejected.
 * - `contract()`: the deserialized contract for this member — lazily
 *   produced on first call and memoised. For the app it is the live
 *   contract the caller supplied; for an extension it is the on-disk
 *   `migrations/<spaceId>/contract.json` run through the family's
 *   `deserializeContract`. Throws if the on-disk contract is missing or
 *   undeserializable (surfaced as `contractUnreadable` by `checkIntegrity`
 *   under `requireContracts`); callers gate before querying it.
 */
export interface ContractSpaceMember {
  readonly spaceId: string;
  readonly packages: readonly OnDiskMigrationPackage[];
  readonly refs: Refs;
  readonly headRef: ContractSpaceHeadRecord | null;
  graph(): MigrationGraph;
  contract(): Contract;
}

/**
 * Tolerant, queryable snapshot of a project's on-disk migration state:
 * the app contract space plus every extension contract space, each a
 * {@link ContractSpaceMember}.
 *
 * Produced once per CLI invocation by `loadContractSpaceAggregate`.
 * Building the aggregate never throws on disk content; every consumer
 * obtains spaces / packages / refs / graphs from this one value rather
 * than re-deriving them from disk.
 *
 * - `targetId`: the app contract's target; every member is expected to
 *   share it (a mismatch surfaces as a `targetMismatch` violation under
 *   `requireContracts`).
 * - `app` / `extensions`: retained as fields for the existing planner /
 *   verifier / runner consumers. `extensions` is sorted alphabetically
 *   by `spaceId` (the apply-ordering convention).
 * - `listSpaces()` / `hasSpace()` / `space()` / `spaces()`: the query
 *   surface the read commands consume — `app` first, then extension ids
 *   lex-ascending.
 * - `checkIntegrity()`: judges the loaded model and returns every
 *   violation (never bailing at the first). Config/contract-dependent
 *   checks run only when the matching {@link IntegrityQueryOptions} opt
 *   is set.
 */
export interface ContractSpaceAggregate {
  readonly targetId: string;
  readonly app: ContractSpaceMember;
  readonly extensions: readonly ContractSpaceMember[];
  listSpaces(): readonly string[];
  hasSpace(id: string): boolean;
  space(id: string): ContractSpaceMember | undefined;
  spaces(): readonly ContractSpaceMember[];
  checkIntegrity(opts?: IntegrityQueryOptions): readonly IntegrityViolation[];
}
