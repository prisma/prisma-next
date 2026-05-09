import { readPinnedHeadRef } from './read-pinned-head-ref';
import { APP_SPACE_ID } from './space-layout';
import { listPinnedSpaceDirectories, type SpacePinnedHashRecord } from './verify-contract-spaces';

/**
 * Disk-side inputs to {@link import('./verify-contract-spaces').verifyContractSpaces}
 * — gathered without touching the live database. The caller composes
 * this with the marker rows it reads from the runtime to invoke the
 * verifier.
 */
export interface DiskContractSpaceState {
  /** Pinned directory names observed under `<projectMigrationsDir>/`. */
  readonly pinnedDirsOnDisk: readonly string[];
  /** Pinned head-ref `(hash, invariants)` per extension space. */
  readonly pinnedHashesBySpace: ReadonlyMap<string, SpacePinnedHashRecord>;
}

/**
 * Read the on-disk state the per-space verifier needs:
 *
 * - The list of pinned space directories under
 *   `<projectMigrationsDir>/` (via
 *   {@link import('./verify-contract-spaces').listPinnedSpaceDirectories}).
 * - The pinned `(hash, invariants)` for each declared extension space
 *   (via {@link readPinnedHeadRef}; missing pinned files are simply
 *   omitted — the verifier reports them as `declaredButUnmigrated`).
 *
 * Synchronous in spirit but async due to filesystem reads. Reads only
 * the user's repo. **Does not import any extension descriptor module.**
 *
 * Composition convention: pure
 * target-agnostic primitive in `1-framework`; the SQL family (and any
 * future target family) wires it into its `dbInit` / `verify` flows
 * alongside its own marker-row read before invoking
 * `verifyContractSpaces`.
 */
export async function gatherDiskContractSpaceState(args: {
  readonly projectMigrationsDir: string;
  /**
   * Set of space ids the project declares: `'app'` plus each entry in
   * `extensionPacks` whose descriptor exposes a `contractSpace`. The
   * helper reads pinned data only for the extension members.
   */
  readonly loadedSpaceIds: ReadonlySet<string>;
}): Promise<DiskContractSpaceState> {
  const { projectMigrationsDir, loadedSpaceIds } = args;

  const pinnedDirsOnDisk = await listPinnedSpaceDirectories(projectMigrationsDir);

  const pinnedHashesBySpace = new Map<string, SpacePinnedHashRecord>();
  for (const spaceId of loadedSpaceIds) {
    if (spaceId === APP_SPACE_ID) continue;
    const pinned = await readPinnedHeadRef(projectMigrationsDir, spaceId);
    if (pinned !== null) {
      pinnedHashesBySpace.set(spaceId, pinned);
    }
  }

  return { pinnedDirsOnDisk, pinnedHashesBySpace };
}
