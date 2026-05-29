import { readMigrationsDir } from './io';
import type { MigrationListEntry, MigrationSpaceListEntry } from './migration-list-types';
import { readRefs } from './refs';
import {
  APP_SPACE_ID,
  isValidSpaceId,
  RESERVED_SPACE_SUBDIR_NAMES,
  spaceMigrationDirectory,
  spaceRefsDirectory,
} from './space-layout';
import { listContractSpaceDirectories } from './verify-contract-spaces';

/**
 * Index `migrations/<space>/refs/*.json` by the contract hash each ref
 * points at, so callers can attach `(ref names)` decorations to every
 * row whose destination contract hash matches.
 *
 * Each bucket is sorted lex-asc to keep rendered output deterministic
 * (adjacent rows pointing at the same hash render their ref decorations
 * in the same order).
 *
 * Refs whose hash matches no migration on disk are still indexed; the
 * caller decides whether to surface them. Migration rows only carry
 * `(refs)` decorations when a matching destination contract hash exists
 * on disk — orphan refs are not rendered on any row.
 *
 * Returns an empty map when the refs directory does not exist
 * ({@link readRefs} treats `ENOENT` as "no refs").
 */
export async function resolveRefsByContractHash(
  refsDir: string,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const refs = await readRefs(refsDir);
  const byHash = new Map<string, string[]>();
  for (const [name, entry] of Object.entries(refs)) {
    const bucket = byHash.get(entry.hash);
    if (bucket) bucket.push(name);
    else byHash.set(entry.hash, [name]);
  }
  for (const bucket of byHash.values()) {
    bucket.sort();
  }
  return byHash;
}

/**
 * Compare two contract-space IDs for the inter-space ordering rule:
 * {@link APP_SPACE_ID} first if present, then lex-asc on the rest.
 */
function compareSpaceIds(a: string, b: string): number {
  if (a === APP_SPACE_ID) return b === APP_SPACE_ID ? 0 : -1;
  if (b === APP_SPACE_ID) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Sort `dirName` descending so the rendered output reads latest-first,
 * matching the `git log` latest-first convention.
 */
function compareDirNamesDescending(a: MigrationListEntry, b: MigrationListEntry): number {
  if (a.dirName < b.dirName) return 1;
  if (a.dirName > b.dirName) return -1;
  return 0;
}

/**
 * Enumerate every contract space's on-disk migrations under
 * `<projectMigrationsDir>/`. For each valid space directory:
 *
 * - Loads on-disk packages via {@link readMigrationsDir}.
 * - Attaches ref decorations: each migration's `refs[]` lists every ref
 *   name from `migrations/<spaceId>/refs/*.json` whose hash equals the
 *   migration's destination contract hash.
 * - Sorts migrations within the space by `dirName` descending
 *   (reverse-filename, latest first).
 *
 * Contract spaces are returned with {@link APP_SPACE_ID} first when
 * present, then the remaining ids lex-asc. A contract-space directory
 * that contains no migrations becomes `{ spaceId, migrations: [] }` so
 * the renderer's empty-state path can surface it.
 *
 * Directory entries that are not valid {@link isValidSpaceId} names are
 * skipped (a stray non-space directory under `migrations/` does not
 * spawn a phantom space entry). Entries whose name appears in
 * {@link RESERVED_SPACE_SUBDIR_NAMES} are also skipped — the per-space
 * `refs/` subdirectory name shape would otherwise satisfy
 * {@link isValidSpaceId} and surface as a phantom contract space.
 *
 * Returns `[]` when `<projectMigrationsDir>` does not exist — a fresh
 * project that has not authored any migration yet.
 */
export async function enumerateMigrationSpaces(args: {
  readonly projectMigrationsDir: string;
}): Promise<readonly MigrationSpaceListEntry[]> {
  const { projectMigrationsDir } = args;
  const candidateDirs = await listContractSpaceDirectories(projectMigrationsDir);
  const spaceIds = candidateDirs
    .filter((name) => !RESERVED_SPACE_SUBDIR_NAMES.has(name))
    .filter(isValidSpaceId)
    .sort(compareSpaceIds);

  const spaces: MigrationSpaceListEntry[] = [];
  for (const spaceId of spaceIds) {
    const spaceDir = spaceMigrationDirectory(projectMigrationsDir, spaceId);
    const { packages } = await readMigrationsDir(spaceDir);
    const refsByHash = await resolveRefsByContractHash(spaceRefsDirectory(spaceDir));

    const migrations: MigrationListEntry[] = packages
      .map((pkg) => ({
        dirName: pkg.dirName,
        from: pkg.metadata.from,
        to: pkg.metadata.to,
        migrationHash: pkg.metadata.migrationHash,
        operationCount: pkg.ops.length,
        createdAt: pkg.metadata.createdAt,
        refs: refsByHash.get(pkg.metadata.to) ?? [],
        providedInvariants: pkg.metadata.providedInvariants,
      }))
      .sort(compareDirNamesDescending);

    spaces.push({ spaceId, migrations });
  }

  return spaces;
}
