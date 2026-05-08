import { readdir, stat } from 'node:fs/promises';
import { join } from 'pathe';
import { MANIFEST_FILE } from './io';
import { APP_SPACE_ID } from './space-layout';

function hasErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as { code?: string }).code === code;
}

/**
 * List the per-space pinned subdirectories under
 * `<projectRoot>/migrations/`. Returns space-id directory names (sorted
 * alphabetically) — i.e. any non-dot-prefixed subdirectory whose root
 * does **not** contain a `migration.json` manifest. The manifest is the
 * structural marker of a user-authored migration directory (see
 * `readMigrationsDir` in `./io`); directory names themselves belong to
 * the user and are not part of the contract.
 *
 * Returns `[]` if the migrations directory does not exist (greenfield
 * project).
 *
 * Reads only the user's repo. **No descriptor import.** The caller
 * (verifier) feeds the result into {@link verifyContractSpaces} alongside
 * the loaded-space set and the marker rows.
 *
 * @see specs/framework-mechanism.spec.md § 4 — Verifier (steps 5–6).
 */
export async function listPinnedSpaceDirectories(
  projectMigrationsDir: string,
): Promise<readonly string[]> {
  let entries: { readonly name: string; readonly isDirectory: boolean }[];
  try {
    const dirents = await readdir(projectMigrationsDir, { withFileTypes: true });
    entries = dirents.map((d) => ({ name: d.name, isDirectory: d.isDirectory() }));
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return [];
    }
    throw error;
  }

  const namedCandidates = entries
    .filter((e) => e.isDirectory)
    .map((e) => e.name)
    .filter((name) => !name.startsWith('.'))
    .sort();

  const manifestChecks = await Promise.all(
    namedCandidates.map(async (name) => {
      try {
        await stat(join(projectMigrationsDir, name, MANIFEST_FILE));
        return { name, isMigrationDir: true };
      } catch (error) {
        if (hasErrnoCode(error, 'ENOENT')) {
          return { name, isMigrationDir: false };
        }
        throw error;
      }
    }),
  );

  return manifestChecks.filter((c) => !c.isMigrationDir).map((c) => c.name);
}

/**
 * Pinned head value (`(hash, invariants)`) for one contract space.
 * The verifier compares this against the marker row for the same space
 * to detect drift between the user-emitted artefacts and the live DB
 * marker.
 */
export interface SpacePinnedHashRecord {
  readonly hash: string;
  readonly invariants: readonly string[];
}

/**
 * Marker row read from `prisma_contract.marker` (one per `space`).
 * Caller resolves these via the family runtime's marker reader (T1.1)
 * before invoking {@link verifyContractSpaces}.
 */
export interface SpaceMarkerRecord {
  readonly hash: string;
  readonly invariants: readonly string[];
}

export interface VerifyContractSpacesInputs {
  /**
   * Set of contract spaces the project declares: `'app'` plus each
   * extension space in `extensionPacks`. The caller's discovery path
   * never reads the extension descriptor module — it walks the
   * `extensionPacks` configuration in `prisma-next.config.ts` for the
   * space ids.
   */
  readonly loadedSpaces: ReadonlySet<string>;

  /**
   * Pinned per-space subdirectories observed under
   * `<projectRoot>/migrations/`. Resolved via
   * {@link listPinnedSpaceDirectories}.
   */
  readonly pinnedDirsOnDisk: readonly string[];

  /**
   * Pinned head ref per space, keyed by space id. Caller reads
   * `<projectRoot>/migrations/<space-id>/contract.json` and
   * `refs/head.json` (or, for app-space if its pinned shape ever moves
   * under `migrations/`, the equivalent files) to construct this map.
   * Spaces with no pinned dir on disk simply omit a map entry.
   */
  readonly pinnedHashesBySpace: ReadonlyMap<string, SpacePinnedHashRecord>;

  /**
   * Marker rows keyed by `space`. Caller reads them from the
   * `prisma_contract.marker` table.
   */
  readonly markerRowsBySpace: ReadonlyMap<string, SpaceMarkerRecord>;
}

export type SpaceVerifierViolation =
  | {
      readonly kind: 'declaredButUnmigrated';
      readonly spaceId: string;
      readonly remediation: string;
    }
  | {
      readonly kind: 'orphanMarker';
      readonly spaceId: string;
      readonly remediation: string;
    }
  | {
      readonly kind: 'orphanPinnedDir';
      readonly spaceId: string;
      readonly remediation: string;
    }
  | {
      readonly kind: 'hashMismatch';
      readonly spaceId: string;
      readonly pinnedHash: string;
      readonly markerHash: string;
      readonly remediation: string;
    }
  | {
      readonly kind: 'invariantsMismatch';
      readonly spaceId: string;
      readonly pinnedInvariants: readonly string[];
      readonly markerInvariants: readonly string[];
      readonly remediation: string;
    };

export type VerifyContractSpacesResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly SpaceVerifierViolation[] };

/**
 * Pure structural verifier for the per-space mechanism. Aggregates the
 * three orphan / missing checks (FR6 cases a–c) plus per-space hash and
 * invariant comparison.
 *
 * Algorithm (sub-spec § 4):
 *
 * - For every extension space declared in `loadedSpaces` (`'app'`
 *   excluded — its pinned `contract.json` lives at the project root):
 *   - If no pinned dir on disk → `declaredButUnmigrated`.
 *   - Else if `markerRowsBySpace` lacks an entry → no violation here;
 *     the live-DB compare in step 8 (out of scope of this helper) is
 *     where the absence shows up.
 *   - Else compare marker hash / invariants vs. pinned hash /
 *     invariants → `hashMismatch` / `invariantsMismatch` on drift.
 * - For every pinned dir on disk that is not in `loadedSpaces` →
 *   `orphanPinnedDir`.
 * - For every marker row whose `space` is not in `loadedSpaces` →
 *   `orphanMarker`. The app-space marker is always loaded (`'app'` is
 *   in `loadedSpaces` by definition).
 *
 * Output is deterministic (NFR6): violations are sorted first by `kind`
 * (`declaredButUnmigrated` → `orphanMarker` → `orphanPinnedDir` →
 * `hashMismatch` → `invariantsMismatch`) then by `spaceId`. Two callers
 * passing equivalent inputs see byte-identical violation lists.
 *
 * Synchronous, pure, no I/O. **Does not import the extension descriptor**
 * (the inputs are pre-resolved by the caller). This is the property
 * AC-15 / AC-26 ("verifier reads only the user repo, not
 * `node_modules`") locks in.
 *
 * @see specs/framework-mechanism.spec.md § 4 — Verifier (T1.5).
 */
export function verifyContractSpaces(
  inputs: VerifyContractSpacesInputs,
): VerifyContractSpacesResult {
  const violations: SpaceVerifierViolation[] = [];

  for (const spaceId of [...inputs.loadedSpaces].sort()) {
    if (spaceId === APP_SPACE_ID) continue;

    if (!inputs.pinnedDirsOnDisk.includes(spaceId)) {
      violations.push({
        kind: 'declaredButUnmigrated',
        spaceId,
        remediation: `Extension '${spaceId}' is declared in extensionPacks but has not been emitted; run \`prisma-next migrate\`.`,
      });
      continue;
    }

    const pinned = inputs.pinnedHashesBySpace.get(spaceId);
    const marker = inputs.markerRowsBySpace.get(spaceId);
    if (!pinned || !marker) {
      continue;
    }

    if (pinned.hash !== marker.hash) {
      violations.push({
        kind: 'hashMismatch',
        spaceId,
        pinnedHash: pinned.hash,
        markerHash: marker.hash,
        remediation: `Marker row for space '${spaceId}' is keyed at ${marker.hash}, but the pinned ${join('migrations', spaceId, 'contract.json')} resolves to ${pinned.hash}. Run \`prisma-next db update\` to advance the database, or \`prisma-next migrate\` if the descriptor was bumped without re-emitting.`,
      });
      continue;
    }

    const pinnedInvariants = [...pinned.invariants].sort();
    const markerInvariants = new Set(marker.invariants);
    const missing = pinnedInvariants.filter((id) => !markerInvariants.has(id));
    if (missing.length > 0) {
      violations.push({
        kind: 'invariantsMismatch',
        spaceId,
        pinnedInvariants,
        markerInvariants: [...marker.invariants].sort(),
        remediation: `Marker row for space '${spaceId}' is missing invariants [${missing.map((s) => JSON.stringify(s)).join(', ')}]. Run \`prisma-next db update\` to apply the corresponding data-transform migrations.`,
      });
    }
  }

  for (const dir of [...inputs.pinnedDirsOnDisk].sort()) {
    if (!inputs.loadedSpaces.has(dir)) {
      violations.push({
        kind: 'orphanPinnedDir',
        spaceId: dir,
        remediation: `Orphan pinned directory \`${join('migrations', dir)}/\` for an extension not in extensionPacks; remove the directory or re-add the extension.`,
      });
    }
  }

  for (const space of [...inputs.markerRowsBySpace.keys()].sort()) {
    if (!inputs.loadedSpaces.has(space)) {
      violations.push({
        kind: 'orphanMarker',
        spaceId: space,
        remediation: `Orphan marker row for space '${space}' (no longer in extensionPacks); remediation: manually delete the row from \`prisma_contract.marker\`.`,
      });
    }
  }

  if (violations.length === 0) {
    return { ok: true };
  }

  const kindOrder: Record<SpaceVerifierViolation['kind'], number> = {
    declaredButUnmigrated: 0,
    orphanMarker: 1,
    orphanPinnedDir: 2,
    hashMismatch: 3,
    invariantsMismatch: 4,
  };

  violations.sort((a, b) => {
    const k = kindOrder[a.kind] - kindOrder[b.kind];
    if (k !== 0) return k;
    if (a.spaceId < b.spaceId) return -1;
    if (a.spaceId > b.spaceId) return 1;
    return 0;
  });

  return { ok: false, violations };
}
