import { readFile } from 'node:fs/promises';
import { join } from 'pathe';
import { errorInvalidJson, errorInvalidRefFile, errorPinnedArtefactsAppSpace } from './errors';
import { APP_SPACE_ID, assertValidSpaceId } from './space-layout';

function hasErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as { code?: string }).code === code;
}

/**
 * Pinned head-ref record — the `(hash, invariants)` pair the framework
 * wrote into `<projectMigrationsDir>/<spaceId>/refs/head.json` on the last
 * `migrate` for this space.
 */
export interface PinnedHeadRef {
  readonly hash: string;
  readonly invariants: readonly string[];
}

/**
 * Read the full pinned head ref (`hash` + `invariants`) for an extension
 * space. Companion to {@link import('./read-pinned-contract-hash').readPinnedContractHash}
 * — same parsing rules, but surfaces both fields rather than only the
 * hash so the verifier can compare invariants against marker rows.
 *
 * Returns `null` when the pinned file does not exist (first emit).
 */
export async function readPinnedHeadRef(
  projectMigrationsDir: string,
  spaceId: string,
): Promise<PinnedHeadRef | null> {
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

  if (typeof parsed !== 'object' || parsed === null) {
    throw errorInvalidRefFile(filePath, 'expected an object');
  }
  const obj = parsed as { hash?: unknown; invariants?: unknown };
  if (typeof obj.hash !== 'string') {
    throw errorInvalidRefFile(filePath, 'expected an object with a string `hash` field');
  }
  if (!Array.isArray(obj.invariants) || obj.invariants.some((value) => typeof value !== 'string')) {
    throw errorInvalidRefFile(filePath, 'expected an object with an `invariants` array of strings');
  }

  return { hash: obj.hash, invariants: obj.invariants as readonly string[] };
}
