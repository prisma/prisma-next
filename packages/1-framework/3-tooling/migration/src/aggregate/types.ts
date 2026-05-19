import type { Contract } from '@prisma-next/contract/types';
import type { MigrationGraph } from '../graph';
import type { OnDiskMigrationPackage } from '../package';

/**
 * Hydrated migration graph for a single contract space.
 *
 * `graph` is the structural shortest-path graph (forward / reverse chain,
 * deterministic tie-break order) reconstructed from a set of on-disk
 * migration packages. `packagesByMigrationHash` is the lookup table the
 * graph-walk strategy uses to resolve a path's edge sequence back to the
 * concrete `OnDiskMigrationPackage` (and therefore the operation list) for
 * apply.
 *
 * Eagerly hydrated by the loader. Once a `ContractSpaceAggregate` exists,
 * downstream consumers do **not** touch the filesystem to walk graphs or
 * resolve packages — the aggregate is the boundary.
 */
export interface HydratedMigrationGraph {
  readonly graph: MigrationGraph;
  readonly packagesByMigrationHash: ReadonlyMap<string, OnDiskMigrationPackage>;
}

/**
 * One contract space — app or extension — as a member of a
 * {@link ContractSpaceAggregate}. Every member has the same shape.
 *
 * - `spaceId`: `'app'` for the application, otherwise the extension's
 *   id (validated against `[a-z][a-z0-9_-]{0,63}`).
 * - `contract`: the validated contract value for this member. For the
 *   app, the user's authored contract; for an extension, the on-disk
 *   `migrations/<spaceId>/contract.json`. Both have already passed the
 *   family's `deserializeContract` at the loader boundary.
 * - `headRef.hash`: the storage hash this member is targeting. For the
 *   app, equals `contract.storage.storageHash`. For extensions, the
 *   on-disk `refs/head.json.hash`.
 * - `headRef.invariants`: alphabetically sorted, deduplicated invariant
 *   ids declared on the head ref. Empty for the app member (the app's
 *   plan is synthesised from the contract IR, no invariants required).
 * - `migrations`: the hydrated migration graph for this space. Possibly
 *   empty (an extension whose on-disk head ref points at the
 *   empty-contract sentinel and ships no migrations yet, or the app
 *   when the user hasn't authored any).
 */
export interface ContractSpaceMember {
  readonly spaceId: string;
  readonly contract: Contract;
  readonly headRef: {
    readonly hash: string;
    readonly invariants: readonly string[];
  };
  readonly migrations: HydratedMigrationGraph;
}

/**
 * Typed value carrying the user's app contract plus every loaded
 * extension contract space, fully hydrated and internally consistent.
 *
 * Produced once per CLI invocation by `loadContractSpaceAggregate`.
 * Every downstream component (planner, verifier, runner adapter)
 * consumes this value rather than rebuilding state from disk.
 *
 * Invariants the loader enforces at construction:
 *
 * 1. `targetId` is consistent across every member (`contract.target`
 *    matches `aggregate.targetId`). The aggregate's `targetId` is the
 *    `Config.adapter.targetId` value the loader was told to use.
 * 2. `aggregate.extensions` is sorted alphabetically by `spaceId`.
 *    Mirrors {@link import('../concatenate-space-apply-inputs').concatenateSpaceApplyInputs}'s
 *    extension ordering convention so downstream apply order matches
 *    today's behaviour byte-for-byte.
 * 3. No two members claim the same storage element (table / type / etc.).
 * 4. For each extension member: `member.headRef.hash` is reachable from
 *    the empty-contract sentinel in `member.migrations.graph` (or the
 *    graph is empty and `member.headRef.hash === EMPTY_CONTRACT_HASH`).
 * 5. For the app member: `member.headRef.hash` equals
 *    `member.contract.storage.storageHash`. The app's `migrations`
 *    is hydrated from the user's authored `migrations/` (or empty if
 *    none).
 *
 * The aggregate is **type-uniform** post-construction: app/extension
 * distinguishability survives only at the caller-policy layer
 * (`ignoreGraphFor: new Set([appSpaceId])`), not on member shape.
 */
export interface ContractSpaceAggregate {
  readonly targetId: string;
  readonly app: ContractSpaceMember;
  readonly extensions: readonly ContractSpaceMember[];
}
