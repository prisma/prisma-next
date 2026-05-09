import { join } from 'pathe';
import { errorInvalidSpaceId } from './errors';

/**
 * Logical identifier of the application's contract space. Matches the
 * default value of `prisma_contract.marker.space`
 * (`packages/2-sql/5-runtime/src/sql-marker.ts`); duplicated here so the
 * authoring layer (`migration-tools`) can reason about per-space layout
 * without depending on a target-runtime package.
 */
export const APP_SPACE_ID = 'app' as const;

/**
 * Branded string carrying a compile-time guarantee that the value has
 * been validated by {@link assertValidSpaceId}. Downstream filesystem
 * helpers (e.g. {@link spaceMigrationDirectory}) accept this type to
 * make "validated" tracking visible at the type level rather than
 * relying purely on a runtime check.
 */
export type ValidSpaceId = string & { readonly __brand: 'ValidSpaceId' };

/**
 * Pattern a contract-space identifier must match. The constraint is
 * filesystem-friendly: lowercase letters / digits / hyphen / underscore,
 * starts with a letter, max 64 characters.
 */
const SPACE_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export function isValidSpaceId(spaceId: string): spaceId is ValidSpaceId {
  return SPACE_ID_PATTERN.test(spaceId);
}

export function assertValidSpaceId(spaceId: string): asserts spaceId is ValidSpaceId {
  if (!isValidSpaceId(spaceId)) {
    throw errorInvalidSpaceId(spaceId);
  }
}

/**
 * Resolve the migrations subdirectory for a given contract space.
 *
 * - **App space** (`spaceId === APP_SPACE_ID`) keeps today's layout: the
 *   project's `migrations/` directory is the migrations directory, no
 *   subdirectory.
 * - **Extension space** lands under `<projectMigrationsDir>/<spaceId>/`.
 *   The space id is validated against {@link SPACE_ID_PATTERN} because
 *   it becomes a filesystem directory name verbatim.
 *
 * `projectMigrationsDir` is the project's top-level `migrations/`
 * directory; the helper does not assume anything about its absolute /
 * relative shape and is symmetric with `pathe.join`.
 */
export function spaceMigrationDirectory(projectMigrationsDir: string, spaceId: string): string {
  if (spaceId === APP_SPACE_ID) {
    return projectMigrationsDir;
  }
  assertValidSpaceId(spaceId);
  return join(projectMigrationsDir, spaceId);
}
