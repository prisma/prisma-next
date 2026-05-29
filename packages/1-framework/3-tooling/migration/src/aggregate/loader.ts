import type { Contract } from '@prisma-next/contract/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { EMPTY_CONTRACT_HASH } from '../constants';
import { errorSameSourceAndTarget, MigrationToolsError } from '../errors';
import { readMigrationsDir } from '../io';
import { reconstructGraph } from '../migration-graph';
import type { OnDiskMigrationPackage } from '../package';
import { readContractSpaceContract } from '../read-contract-space-contract';
import { readContractSpaceHeadRef } from '../read-contract-space-head-ref';
import { APP_SPACE_ID, spaceMigrationDirectory } from '../space-layout';
import { listContractSpaceDirectories } from '../verify-contract-spaces';
import { extractStorageElementNames } from './extract-storage-element-names';
import type { ContractSpaceAggregate, ContractSpaceMember, HydratedMigrationGraph } from './types';

function integrityDetail(error: unknown): string {
  if (MigrationToolsError.is(error)) {
    return error.why;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function loadProblemDetail(problem: import('../io').PackageLoadProblem): string {
  switch (problem.kind) {
    case 'hashMismatch':
      return `Migration "${problem.dirName}" stored hash "${problem.stored}" does not match computed hash "${problem.computed}".`;
    case 'providedInvariantsMismatch':
      return `Migration "${problem.dirName}" providedInvariants in migration.json disagrees with ops.json.`;
    case 'packageUnloadable':
      return `Migration "${problem.dirName}" could not be loaded: ${problem.detail}`;
  }
}

/**
 * Single declared extension entry the loader needs from `Config.extensionPacks`.
 *
 * Only the subset of fields the loader operates on:
 *
 * - `id` — the space id (also the directory name under `migrations/`).
 * - `targetId` — the configured `Config.adapter.targetId` value the
 *   declaring extension declared. The loader rejects mismatches against
 *   the aggregate's `targetId` with `targetMismatch`.
 *
 * Whether the descriptor declares a contract space is decided by whether
 * its corresponding `migrations/<id>/` directory exists on disk
 * (materialised by the seed phase before the loader runs); the loader
 * never reads the descriptor's `contractJson` itself. That makes the
 * aggregate's apply / verify paths byte-for-byte independent of the
 * descriptor module — `db verify` succeeds even if the descriptor's
 * `contractJson` is a throwing getter.
 *
 * Typed structurally so the migration-tools layer stays framework-neutral.
 */
export interface DeclaredExtensionEntry {
  readonly id: string;
  readonly targetId: string;
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
  readonly deserializeContract: (contractJson: unknown) => Contract;
  /**
   * Hydrated migration graph for the **app member**.
   *
   * The framework-neutral migration-tools layer doesn't know how to read
   * the user's authored `migrations/` directory (the app member's
   * migration-package layout is family-aware: ops.json shape, manifest
   * keys, etc.). Callers — the SQL family today — read the user's
   * `migrations/` and hand the resulting `OnDiskMigrationPackage[]` through.
   *
   * Passing `[]` is valid (greenfield project, no authored migrations).
   * Equivalent to `migrations/` not existing or being empty.
   */
  readonly appMigrationPackages: ReadonlyArray<OnDiskMigrationPackage>;
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
 *   a `contractSpace` but no contract-space dir on disk. Remediation:
 *   `prisma-next migrate`.
 * - `orphanSpaceDir`: contract-space dir under `migrations/` for an extension
 *   not in `extensionPacks`. Remediation: remove the directory, or
 *   re-add the extension to `extensionPacks`.
 */
export type LayoutViolation =
  | { readonly kind: 'declaredButUnmigrated'; readonly spaceId: string }
  | { readonly kind: 'orphanSpaceDir'; readonly spaceId: string };

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
 * the app contract value the caller supplies.
 *
 * The loader is the **only** descriptor-import boundary at apply /
 * verify time, but it intentionally does **not** read the extension
 * descriptor's `contractJson` value. Each extension space's contract
 * is read from its on-disk `migrations/<id>/contract.json` mirror; the
 * descriptor's role is exhausted by the seed phase that wrote that
 * mirror in the first place. The loader composes existing
 * migration-tools primitives — layout precheck (via
 * {@link listContractSpaceDirectories}), integrity checks (via
 * {@link readMigrationsDir} / {@link readContractSpaceHeadRef} /
 * {@link readContractSpaceContract} / `deserializeContract`), and
 * disjointness — into a single typed value.
 *
 * Failure semantics: every failure variant in {@link LoadAggregateError}
 * short-circuits the load.
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
  //
  // Every declared extension contributes an entry to the aggregate when
  // a corresponding `migrations/<id>/` directory exists on disk. The
  // loader treats the directory's presence as the membership signal —
  // the descriptor itself is not read — so codec-only extensions (no
  // on-disk dir) and contract-space extensions (dir present) are
  // distinguished structurally.
  const declaredSpaceIds = new Set(input.declaredExtensions.map((e) => e.id));
  const allDirs = await listContractSpaceDirectories(input.migrationsDir);
  // The app member is implicitly declared (it is always part of the
  // aggregate); its `migrations/<APP_SPACE_ID>/` directory may exist or
  // not (greenfield projects start with neither). Filter it out of the
  // orphan / declared-but-unmigrated checks so the layout precheck is
  // about extensions only.
  const extensionDirsOnDisk = allDirs.filter((d) => d !== APP_SPACE_ID);
  const spaceDirSet = new Set(extensionDirsOnDisk);

  const layoutViolations: LayoutViolation[] = [];
  for (const dir of extensionDirsOnDisk) {
    if (!declaredSpaceIds.has(dir)) {
      layoutViolations.push({ kind: 'orphanSpaceDir', spaceId: dir });
    }
  }
  for (const id of [...declaredSpaceIds].sort()) {
    if (!spaceDirSet.has(id)) {
      layoutViolations.push({ kind: 'declaredButUnmigrated', spaceId: id });
    }
  }
  if (layoutViolations.length > 0) {
    return notOk({ kind: 'layoutViolation', violations: layoutViolations });
  }

  // 3-5. Per-extension: read + validate + integrity-check.
  const loadedExtensions: LoadedExtensionState[] = [];
  for (const entry of [...input.declaredExtensions].sort((a, b) => a.id.localeCompare(b.id))) {
    const headRef = await readContractSpaceHeadRef(input.migrationsDir, entry.id);
    if (headRef === null) {
      return notOk({
        kind: 'integrityFailure',
        spaceId: entry.id,
        detail: `Head ref \`refs/head.json\` is missing for extension space "${entry.id}".`,
      });
    }

    let spaceContractRaw: unknown;
    try {
      spaceContractRaw = await readContractSpaceContract(input.migrationsDir, entry.id);
    } catch (error) {
      return notOk({
        kind: 'integrityFailure',
        spaceId: entry.id,
        detail: integrityDetail(error),
      });
    }

    let spaceContract: Contract;
    try {
      spaceContract = input.deserializeContract(spaceContractRaw);
    } catch (error) {
      return notOk({
        kind: 'validationFailure',
        spaceId: entry.id,
        detail: integrityDetail(error),
      });
    }

    if (spaceContract.target !== input.targetId) {
      return notOk({
        kind: 'targetMismatch',
        spaceId: entry.id,
        expected: input.targetId,
        actual: spaceContract.target,
      });
    }

    // Read the migration packages. readMigrationsDir no longer throws on
    // content-level errors; problems are returned alongside retained packages.
    // Transitional shim: convert any load-time problem back to integrityFailure
    // until checkIntegrity() subsumes this check (removed in the aggregate
    // refactor dispatch).
    let packages: readonly OnDiskMigrationPackage[];
    {
      const result = await readMigrationsDir(
        spaceMigrationDirectory(input.migrationsDir, entry.id),
      );
      if (result.problems.length > 0) {
        const first = result.problems[0]!;
        return notOk({
          kind: 'integrityFailure',
          spaceId: entry.id,
          detail: loadProblemDetail(first),
        });
      }
      packages = result.packages;
    }

    // Transitional shim: re-acquire the no-data-op self-edge check that
    // reconstructGraph no longer throws on. Removed when checkIntegrity()
    // subsumes it.
    for (const pkg of packages) {
      const from = pkg.metadata.from ?? EMPTY_CONTRACT_HASH;
      if (from === pkg.metadata.to) {
        const hasDataOp = pkg.ops.some((op) => op.operationClass === 'data');
        if (!hasDataOp) {
          return notOk({
            kind: 'integrityFailure',
            spaceId: entry.id,
            detail: integrityDetail(errorSameSourceAndTarget(pkg.dirPath, from)),
          });
        }
      }
    }

    let graph: ReturnType<typeof reconstructGraph>;
    try {
      graph = reconstructGraph(packages);
    } catch (error) {
      return notOk({
        kind: 'integrityFailure',
        spaceId: entry.id,
        detail: integrityDetail(error),
      });
    }

    // The on-disk head ref must be reachable in the graph. Empty graphs
    // are tolerated only when the head ref points at the empty-contract
    // sentinel (a never-emitted extension space; not a typical scenario
    // because the layout precheck would have flagged the missing
    // dir, but defensible).
    if (graph.nodes.size === 0) {
      if (headRef.hash !== EMPTY_CONTRACT_HASH) {
        return notOk({
          kind: 'integrityFailure',
          spaceId: entry.id,
          detail: `Head ref "${headRef.hash}" is not present in the (empty) on-disk migration graph.`,
        });
      }
    } else if (!graph.nodes.has(headRef.hash)) {
      return notOk({
        kind: 'integrityFailure',
        spaceId: entry.id,
        detail: `Head ref "${headRef.hash}" is not present in the on-disk migration graph.`,
      });
    }

    const packagesByMigrationHash = new Map<string, OnDiskMigrationPackage>(
      packages.map((p) => [p.metadata.migrationHash, p]),
    );

    loadedExtensions.push({
      entry,
      contract: spaceContract,
      headRefHash: headRef.hash,
      headRefInvariants: [...headRef.invariants].sort(),
      migrations: { graph, packagesByMigrationHash },
    });
  }

  // 6. Build app member with hydrated graph from caller-supplied packages.
  //
  // Transitional shim: re-acquire the no-data-op self-edge check for the
  // app packages too. Removed when checkIntegrity() subsumes it.
  for (const pkg of input.appMigrationPackages) {
    const from = pkg.metadata.from ?? EMPTY_CONTRACT_HASH;
    if (from === pkg.metadata.to) {
      const hasDataOp = pkg.ops.some((op) => op.operationClass === 'data');
      if (!hasDataOp) {
        return notOk({
          kind: 'integrityFailure',
          spaceId: APP_SPACE_ID,
          detail: integrityDetail(errorSameSourceAndTarget(pkg.dirPath, from)),
        });
      }
    }
  }

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
  const appPackagesByMigrationHash = new Map<string, OnDiskMigrationPackage>(
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
    const elements = extractStorageElementNames(member.contract);
    for (const elementName of elements) {
      const claimers = elementClaimedBy.get(elementName);
      if (claimers) claimers.push(member.spaceId);
      else elementClaimedBy.set(elementName, [member.spaceId]);
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
