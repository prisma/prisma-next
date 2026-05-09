import { readFile } from 'node:fs/promises';
import { join } from 'pathe';
import { errorInvalidJson, errorMissingFile, errorPinnedArtefactsAppSpace } from './errors';
import { APP_SPACE_ID, assertValidSpaceId } from './space-layout';

function hasErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as { code?: string }).code === code;
}

/**
 * Read the pinned contract value an extension space publishes to disk
 * (`<projectMigrationsDir>/<spaceId>/contract.json`). Returns the parsed
 * JSON value as `unknown` — callers that need a typed contract validate
 * via their family's `validateContract` to surface schema issues.
 *
 * Companion to {@link import('./read-pinned-head-ref').readPinnedHeadRef}
 * — same ENOENT-throws / corrupt-file-error semantics. Returns the
 * canonical-JSON value the framework wrote during emit, so re-running
 * this helper across machines / runs yields a byte-identical value.
 *
 * Rejects the app space id: the app-space contract lives at
 * `<projectRoot>/contract.json`, not under `migrations/`, and using the
 * wrong helper for it would silently look up a non-existent path.
 */
export async function readPinnedSpaceContract(
  projectMigrationsDir: string,
  spaceId: string,
): Promise<unknown> {
  if (spaceId === APP_SPACE_ID) {
    throw errorPinnedArtefactsAppSpace();
  }
  assertValidSpaceId(spaceId);

  const filePath = join(projectMigrationsDir, spaceId, 'contract.json');

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      throw errorMissingFile('contract.json', join(projectMigrationsDir, spaceId));
    }
    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    throw errorInvalidJson(filePath, e instanceof Error ? e.message : String(e));
  }
}
