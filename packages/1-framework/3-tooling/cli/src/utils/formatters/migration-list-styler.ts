import { bold, cyan, cyanBright, dim, green, greenBright, yellow } from 'colorette';
import { IDENTITY_MIGRATION_LIST_STYLER, type MigrationListStyler } from './migration-list-render';

/**
 * The reserved ref name for the live-database marker. Treated as a
 * structurally distinct token from user-named refs so the styler can
 * make it visually pop in `(refs)` decorations.
 */
const DB_REF_NAME = 'db';

function styleRefName(name: string): string {
  return name === DB_REF_NAME ? bold(greenBright(name)) : green(name);
}

/**
 * Build a {@link MigrationListStyler} that decorates `migration list`
 * tokens with ANSI SGR codes. When `useColor` is `false` (non-TTY,
 * `--no-color`, `NO_COLOR=1`, piped output) the function returns the
 * shared identity styler so callers get plain text with zero ANSI
 * bytes — pipe-friendly by construction.
 *
 * Palette:
 *
 * - `dirName`: bold
 * - `sourceHash`: dim cyan
 * - `destHash`: bright cyan
 * - `glyph` (`→` / `⟲` / `∅`): dim
 * - `invariants` (`{...}`): yellow
 * - `refs` (`(...)`): green; the live-DB `db` marker inside is green-bold
 * - `spaceHeading` (`<spaceId>:`): bold
 * - `summary`: dim
 * - `emptyState`: dim
 */
export function createAnsiMigrationListStyler(opts: {
  readonly useColor: boolean;
}): MigrationListStyler {
  if (!opts.useColor) {
    return IDENTITY_MIGRATION_LIST_STYLER;
  }
  return {
    kind: (text) => dim(text),
    dirName: (text) => bold(text),
    sourceHash: (text) => dim(cyan(text)),
    destHash: (text) => cyanBright(text),
    glyph: (text) => dim(text),
    invariants: (ids) => yellow(`{${ids.join(', ')}}`),
    refs: (names) => {
      const open = green('(');
      const close = green(')');
      const separator = green(', ');
      return open + names.map(styleRefName).join(separator) + close;
    },
    spaceHeading: (text) => bold(text),
    summary: (text) => dim(text),
    emptyState: (text) => dim(text),
  };
}
