import { readFile } from 'node:fs/promises';
import { join } from 'pathe';
import { errorInvalidJson, errorInvalidRefFile, errorPinnedArtefactsAppSpace } from './errors';
import { APP_SPACE_ID, assertValidSpaceId } from './space-layout';

function hasErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as { code?: string }).code === code;
}

/**
 * Read the pinned head hash for an extension space.
 *
 * Returns the `hash` field of `<projectMigrationsDir>/<spaceId>/refs/head.json`
 * — i.e. the canonical contract hash the framework wrote on the last
 * `migrate` for this space. Returns `null` when the file does not exist
 * (or the migrations directory is missing entirely), which is the
 * "first emit" signal {@link import('./detect-space-contract-drift').detectSpaceContractDrift}
 * uses to distinguish a brand-new extension from drift.
 *
 * Pure I/O (read + parse). The "comparison hash" is stored on disk by
 * {@link import('./emit-pinned-space-artefacts').emitPinnedSpaceArtefacts}
 * via the descriptor's `headRef.hash`, so reading it back here matches
 * the descriptor's hashing pipeline by construction — neither side
 * recomputes anything.
 *
 * Validation:
 *
 * - Rejects the app space — pinned head refs are an extension-space
 *   concept; the app space's contract-of-record lives at the project
 *   root, not under `migrations/`.
 * - Validates the space id against the same `[a-z][a-z0-9_-]{0,63}`
 *   pattern as the rest of the per-space helpers.
 * - Surfaces `MIGRATION.INVALID_JSON` / `MIGRATION.INVALID_REF_FILE`
 *   on a corrupt `refs/head.json` so callers can distinguish "no
 *   pinned file" (returns `null`) from "pinned file but unreadable"
 *   (throws).
 *
 * @see specs/framework-mechanism.spec.md § 3 — Drift detection (T1.9).
 */
export async function readPinnedContractHash(
  projectMigrationsDir: string,
  spaceId: string,
): Promise<string | null> {
  if (spaceId === APP_SPACE_ID) {
    throw errorPinnedArtefactsAppSpace();
  }
  assertValidSpaceId(spaceId);

  const filePath = join(projectMigrationsDir, spaceId, 'refs', 'head.json');

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return null;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw errorInvalidJson(filePath, e instanceof Error ? e.message : String(e));
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { hash?: unknown }).hash !== 'string'
  ) {
    throw errorInvalidRefFile(filePath, 'expected an object with a string `hash` field');
  }

  return (parsed as { hash: string }).hash;
}
