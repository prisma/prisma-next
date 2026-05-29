import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { join } from 'pathe';
import { errorInvalidSpaceId } from './errors';

export { APP_SPACE_ID };

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
 * Every contract space — including the app space (default `'app'`) —
 * lands under `<projectMigrationsDir>/<spaceId>/`. The space id is
 * validated against {@link SPACE_ID_PATTERN} because it becomes a
 * filesystem directory name verbatim.
 *
 * `projectMigrationsDir` is the project's top-level `migrations/`
 * directory; the helper does not assume anything about its absolute /
 * relative shape and is symmetric with `pathe.join`.
 */
export function spaceMigrationDirectory(projectMigrationsDir: string, spaceId: string): string {
  assertValidSpaceId(spaceId);
  return join(projectMigrationsDir, spaceId);
}

/**
 * Per-space subdirectory name reserved for the ref store
 * (`migrations/<space>/<SPACE_REFS_DIRNAME>/*.json`). Single source of
 * truth: every helper that composes a per-space refs path imports this
 * constant, and the enumerator uses it (via
 * {@link RESERVED_SPACE_SUBDIR_NAMES}) to exclude reserved names from
 * the contract-space candidate list.
 */
export const SPACE_REFS_DIRNAME = 'refs';

/**
 * Names reserved as per-space subdirectories of `migrations/<space>/`.
 * Used by the enumerator to filter contract-space candidates so a
 * reserved name (e.g. a top-level `migrations/refs/` left in the wrong
 * place) is never enumerated as a phantom contract space. Currently
 * holds `SPACE_REFS_DIRNAME`; extend if future per-space layouts add
 * more reserved subdirectories.
 */
export const RESERVED_SPACE_SUBDIR_NAMES: ReadonlySet<string> = new Set([SPACE_REFS_DIRNAME]);

/**
 * Resolve the per-space refs directory for `spaceMigrationsDir`
 * (typically the value returned by {@link spaceMigrationDirectory}).
 * Composes the canonical {@link SPACE_REFS_DIRNAME} so callers do not
 * hard-code the literal.
 */
export function spaceRefsDirectory(spaceMigrationsDir: string): string {
  return join(spaceMigrationsDir, SPACE_REFS_DIRNAME);
}
