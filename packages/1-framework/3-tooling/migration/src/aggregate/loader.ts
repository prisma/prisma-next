import type { Contract } from '@prisma-next/contract/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { EMPTY_CONTRACT_HASH } from '../constants';
import { detectSpaceContractDrift } from '../detect-space-contract-drift';
import { readMigrationsDir } from '../io';
import { reconstructGraph } from '../migration-graph';
import type { MigrationPackage } from '../package';
import { readPinnedHeadRef } from '../read-pinned-head-ref';
import { readPinnedSpaceContract } from '../read-pinned-space-contract';
import { APP_SPACE_ID, spaceMigrationDirectory } from '../space-layout';
import { listPinnedSpaceDirectories } from '../verify-contract-spaces';
import type { ContractSpaceAggregate, ContractSpaceMember, HydratedMigrationGraph } from './types';

/**
 * Hash function used by drift detection. Defaults to a canonical-JSON +
 * SHA-256 pipeline that mirrors the framework's contract-hash convention,
 * but the loader accepts a callback so SQL-family callers can pass their
 * `coreHash` / `storageHash` derivation through unchanged.
 *
 * The contract value passed in is the framework-neutral `unknown` form;
 * callers that have already validated typed contracts can simply hand
 * the validated value back through.
 */
export type AggregateContractHasher = (contract: unknown) => string;

/**
 * Single declared extension entry the loader needs from `Config.extensionPacks`.
 *
 * Only the subset of fields the loader operates on:
 *
 * - `id` — the space id (also the directory name under `migrations/`).
 * - `targetId` — the configured `Config.adapter.targetId` value the
 *   declaring extension declared. The loader rejects mismatches against
 *   the aggregate's `targetId` with `targetMismatch`.
 * - `contractSpace` — present iff the descriptor declares a contract
 *   space (extensions can ship without one and remain runtime-only /
 *   codec-only). Drift detection compares the descriptor's
 *   `contractJson` hash against the on-disk pinned hash; the loader
 *   rejects drift fatally.
 *
 * Typed structurally so the migration-tools layer stays framework-neutral.
 */
export interface DeclaredExtensionEntry {
  readonly id: string;
  readonly targetId: string;
  readonly contractSpace?: {
    readonly contractJson: unknown;
  };
}

/**
 * Inputs for {@link loadContractSpaceAggregate}.
 *
 * The loader is the **sole** descriptor-import boundary in the M2.5
 * pipeline: callers gather the descriptor data (already-validated app
 * contract, declared extension entries) and pass it through. Once the
 * loader returns, no descriptor module is imported again for this
 * aggregate's lifetime.
 */
export interface LoadAggregateInput {
  readonly targetId: string;
  readonly migrationsDir: string;
  readonly appContract: Contract;
  readonly declaredExtensions: ReadonlyArray<DeclaredExtensionEntry>;
  readonly validateContract: (contractJson: unknown) => Contract;
  readonly hashContract: AggregateContractHasher;
  /**
   * Hydrated migration graph for the **app member**.
   *
   * The framework-neutral migration-tools layer doesn't know how to read
   * the user's authored `migrations/` directory (the app member's
   * migration-package layout is family-aware: ops.json shape, manifest
   * keys, etc.). Callers — the SQL family today — read the user's
   * `migrations/` and hand the resulting `MigrationPackage[]` through.
   *
   * Passing `[]` is valid (greenfield project, no authored migrations).
   * Equivalent to `migrations/` not existing or being empty.
   */
  readonly appMigrationPackages: ReadonlyArray<MigrationPackage>;
}

/**
 * Discriminated failure variants the loader emits.
 *
 * Every variant short-circuits at first hit; the loader does not keep
 * collecting after the first violation in any phase except for layout
 * (where every layout offence is bundled into one `layoutViolation`).
 */
export type LoadAggregateError =
  | { readonly kind: 'layoutViolation'; readonly violations: readonly LayoutViolation[] }
  | { readonly kind: 'integrityFailure'; readonly spaceId: string; readonly detail: string }
  | { readonly kind: 'validationFailure'; readonly spaceId: string; readonly detail: string }
  | {
      readonly kind: 'driftViolation';
      readonly spaceId: string;
      readonly pinnedHash: string;
      readonly liveHash: string;
    }
  | {
      readonly kind: 'disjointnessViolation';
      readonly element: string;
      readonly claimedBy: readonly string[];
    }
  | {
      readonly kind: 'targetMismatch';
      readonly spaceId: string;
      readonly expected: string;
      readonly actual: string;
    };

/**
 * Single layout violation; bundled into a `layoutViolation` error so
 * users see every layout offence at once rather than fixing them one
 * at a time across re-runs.
 *
 * - `declaredButUnmigrated`: extension declared in `extensionPacks` with
 *   a `contractSpace` but no pinned dir on disk. Remediation:
 *   `prisma-next migrate`.
 * - `orphanPinnedDir`: pinned dir under `migrations/` for an extension
 *   not in `extensionPacks`. Remediation: remove the directory, or
 *   re-add the extension to `extensionPacks`.
 */
export type LayoutViolation =
  | { readonly kind: 'declaredButUnmigrated'; readonly spaceId: string }
  | { readonly kind: 'orphanPinnedDir'; readonly spaceId: string };

export type LoadAggregateOutput = Result<
  { readonly aggregate: ContractSpaceAggregate },
  LoadAggregateError
>;

interface LoadedExtensionState {
  readonly entry: DeclaredExtensionEntry;
  readonly contract: Contract;
  readonly headRefHash: string;
  readonly headRefInvariants: readonly string[];
  readonly migrations: HydratedMigrationGraph;
}

/**
 * Hydrate a {@link ContractSpaceAggregate} from on-disk state and
 * caller-provided descriptor data.
 *
 * This is the **only** descriptor-import boundary in the post-M2.5
 * pipeline: callers read `extensionPacks` from `Config`, validate the
 * app contract, and pass everything through. The loader composes
 * existing migration-tools primitives — layout precheck (via
 * {@link listPinnedSpaceDirectories}), integrity checks (via
 * {@link readMigrationsDir} / {@link readPinnedHeadRef} /
 * {@link readPinnedSpaceContract} / `validateContract`), drift detection
 * (via {@link detectSpaceContractDrift}), and disjointness — into a
 * single typed value.
 *
 * Failure semantics: every failure variant in {@link LoadAggregateError}
 * short-circuits the load. Drift is fatal (M2.5 spec § Loader, step 5).
 */
export async function loadContractSpaceAggregate(
  input: LoadAggregateInput,
): Promise<LoadAggregateOutput> {
  // 1. Validate target consistency on the app contract.
  const appContractTarget = input.appContract.target;
  if (appContractTarget !== input.targetId) {
    return notOk({
      kind: 'targetMismatch',
      spaceId: APP_SPACE_ID,
      expected: input.targetId,
      actual: appContractTarget,
    });
  }

  for (const entry of input.declaredExtensions) {
    if (entry.targetId !== input.targetId) {
      return notOk({
        kind: 'targetMismatch',
        spaceId: entry.id,
        expected: input.targetId,
        actual: entry.targetId,
      });
    }
  }

  // 2. Layout precheck: bundle every layout offence at once.
  const declaredWithSpace = input.declaredExtensions.filter((e) => e.contractSpace !== undefined);
  const declaredSpaceIds = new Set(declaredWithSpace.map((e) => e.id));
  const pinnedDirs = await listPinnedSpaceDirectories(input.migrationsDir);
  const pinnedDirSet = new Set(pinnedDirs);

  const layoutViolations: LayoutViolation[] = [];
  for (const dir of pinnedDirs) {
    if (!declaredSpaceIds.has(dir)) {
      layoutViolations.push({ kind: 'orphanPinnedDir', spaceId: dir });
    }
  }
  for (const id of [...declaredSpaceIds].sort()) {
    if (!pinnedDirSet.has(id)) {
      layoutViolations.push({ kind: 'declaredButUnmigrated', spaceId: id });
    }
  }
  if (layoutViolations.length > 0) {
    return notOk({ kind: 'layoutViolation', violations: layoutViolations });
  }

  // 3-5. Per-extension: read + validate + integrity-check + drift.
  const loadedExtensions: LoadedExtensionState[] = [];
  for (const entry of [...declaredWithSpace].sort((a, b) => a.id.localeCompare(b.id))) {
    const headRef = await readPinnedHeadRef(input.migrationsDir, entry.id);
    if (headRef === null) {
      return notOk({
        kind: 'integrityFailure',
        spaceId: entry.id,
        detail: `Pinned \`refs/head.json\` is missing for extension space "${entry.id}".`,
      });
    }

    let pinnedContractRaw: unknown;
    try {
      pinnedContractRaw = await readPinnedSpaceContract(input.migrationsDir, entry.id);
    } catch (error) {
      return notOk({
        kind: 'integrityFailure',
        spaceId: entry.id,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    let pinnedContract: Contract;
    try {
      pinnedContract = input.validateContract(pinnedContractRaw);
    } catch (error) {
      return notOk({
        kind: 'validationFailure',
        spaceId: entry.id,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    if (pinnedContract.target !== input.targetId) {
      return notOk({
        kind: 'targetMismatch',
        spaceId: entry.id,
        expected: input.targetId,
        actual: pinnedContract.target,
      });
    }

    // Drift: compare descriptor's live `contractJson` to pinned
    // `refs/head.json.hash`.
    if (entry.contractSpace) {
      const liveHash = input.hashContract(entry.contractSpace.contractJson);
      const drift = detectSpaceContractDrift(entry.id, {
        descriptorHash: liveHash,
        pinnedHash: headRef.hash,
      });
      if (drift.kind === 'drift') {
        return notOk({
          kind: 'driftViolation',
          spaceId: entry.id,
          pinnedHash: drift.pinnedHash ?? '',
          liveHash: drift.descriptorHash,
        });
      }
    }

    // Read + integrity-check the migration packages. `readMigrationsDir`
    // re-derives `providedInvariants` and verifies migrationHash for
    // every package.
    let packages: readonly MigrationPackage[];
    try {
      packages = await readMigrationsDir(spaceMigrationDirectory(input.migrationsDir, entry.id));
    } catch (error) {
      return notOk({
        kind: 'integrityFailure',
        spaceId: entry.id,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    let graph: ReturnType<typeof reconstructGraph>;
    try {
      graph = reconstructGraph(packages);
    } catch (error) {
      return notOk({
        kind: 'integrityFailure',
        spaceId: entry.id,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    // The pinned head ref must be reachable in the graph. Empty graphs
    // are tolerated only when the head ref points at the empty-contract
    // sentinel (a never-emitted extension space; not a typical scenario
    // because the layout precheck would have flagged the missing pinned
    // dir, but defensible).
    if (graph.nodes.size === 0) {
      if (headRef.hash !== EMPTY_CONTRACT_HASH) {
        return notOk({
          kind: 'integrityFailure',
          spaceId: entry.id,
          detail: `Pinned head ref "${headRef.hash}" is not present in the (empty) on-disk migration graph.`,
        });
      }
    } else if (!graph.nodes.has(headRef.hash)) {
      return notOk({
        kind: 'integrityFailure',
        spaceId: entry.id,
        detail: `Pinned head ref "${headRef.hash}" is not present in the on-disk migration graph.`,
      });
    }

    const packagesByMigrationHash = new Map<string, MigrationPackage>(
      packages.map((p) => [p.metadata.migrationHash, p]),
    );

    loadedExtensions.push({
      entry,
      contract: pinnedContract,
      headRefHash: headRef.hash,
      headRefInvariants: [...headRef.invariants].sort(),
      migrations: { graph, packagesByMigrationHash },
    });
  }

  // 6. Build app member with hydrated graph from caller-supplied packages.
  let appGraph: ReturnType<typeof reconstructGraph>;
  try {
    appGraph = reconstructGraph(input.appMigrationPackages);
  } catch (error) {
    return notOk({
      kind: 'integrityFailure',
      spaceId: APP_SPACE_ID,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const appPackagesByMigrationHash = new Map<string, MigrationPackage>(
    input.appMigrationPackages.map((p) => [p.metadata.migrationHash, p]),
  );

  const appMember: ContractSpaceMember = {
    spaceId: APP_SPACE_ID,
    contract: input.appContract,
    headRef: {
      hash: input.appContract.storage.storageHash,
      invariants: [],
    },
    migrations: {
      graph: appGraph,
      packagesByMigrationHash: appPackagesByMigrationHash,
    },
  };

  const extensionMembers: ContractSpaceMember[] = loadedExtensions.map((s) => ({
    spaceId: s.entry.id,
    contract: s.contract,
    headRef: {
      hash: s.headRefHash,
      invariants: s.headRefInvariants,
    },
    migrations: s.migrations,
  }));

  // 7. Disjointness: no two members claim the same storage element.
  const elementClaimedBy = new Map<string, string[]>();
  for (const member of [appMember, ...extensionMembers]) {
    const tables = extractTableNames(member.contract);
    for (const tableName of tables) {
      const claimers = elementClaimedBy.get(tableName);
      if (claimers) claimers.push(member.spaceId);
      else elementClaimedBy.set(tableName, [member.spaceId]);
    }
  }
  for (const [element, claimedBy] of elementClaimedBy) {
    if (claimedBy.length > 1) {
      return notOk({
        kind: 'disjointnessViolation',
        element,
        claimedBy: [...claimedBy].sort(),
      });
    }
  }

  return ok({
    aggregate: {
      targetId: input.targetId,
      app: appMember,
      extensions: extensionMembers,
    },
  });
}

/**
 * Extract the set of top-level storage table names from a contract.
 * Duck-typed: returns `[]` if the contract's storage shape doesn't
 * match the canonical `storage.tables: Record<string, ...>` form. A
 * future family with a different storage shape gets disjointness
 * effectively disabled (not enforced) rather than a hard failure.
 */
function extractTableNames(contract: Contract): readonly string[] {
  const storage = (contract as { readonly storage?: unknown }).storage;
  if (typeof storage !== 'object' || storage === null) return [];
  const tables = (storage as { readonly tables?: unknown }).tables;
  if (typeof tables !== 'object' || tables === null) return [];
  return Object.keys(tables as Record<string, unknown>);
}
