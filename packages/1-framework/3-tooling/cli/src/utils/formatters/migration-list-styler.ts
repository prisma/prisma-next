import { bold, cyan, cyanBright, dim, green, yellow } from 'colorette';
import { IDENTITY_MIGRATION_LIST_STYLER, type MigrationListStyler } from './migration-list-render';

export type MigrationListStylerWithMarkers = MigrationListStyler & {
  markers(names: readonly string[]): string;
};

function hasMarkersFormatter(
  styler: MigrationListStyler,
): styler is MigrationListStylerWithMarkers {
  return 'markers' in styler && typeof styler.markers === 'function';
}

function styleMarkerName(name: string): string {
  return name === CONTRACT_MARKER_NAME ? bold(green(name)) : green(name);
}

function plainMarkers(names: readonly string[]): string {
  return names.map((name) => `@${name}`).join(' ');
}

export function formatContractNodeOverlays(
  styler: MigrationListStyler,
  markers: readonly string[],
  refs: readonly string[],
): string {
  const parts: string[] = [];
  if (markers.length > 0) {
    parts.push(hasMarkersFormatter(styler) ? styler.markers(markers) : plainMarkers(markers));
  }
  if (refs.length > 0) {
    parts.push(styler.refs(refs));
  }
  return parts.join(' ');
}

/**
 * The current contract overlay marker. Unlike user refs, this names the user's
 * declared desired state — the implicit base/target for `plan` / `migrate` —
 * not a stored label. It is emphasized (bold) so it stands out from plain refs
 * (including the live-database `db` marker, which is just another ref).
 */
export const CONTRACT_MARKER_NAME = 'contract';

function styleRefName(name: string): string {
  return green(name);
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
 * - `kind` (`*` / `↩` / `⟲`): bright — the signal; lanes and arrows dim
 * - `glyph` (`→` / `⟲` / `∅`): dim
 * - `lane` (graph gutter lines `│` and fan/join connectors `├─┐` / `├─┘`): dim
 * - `invariants` (`{...}`): yellow
 * - `markers` (`@contract @db`): green; the `contract` desired-state marker is
 *   green-bold (`db` is plain green); the `@` sigil is applied to each name
 * - `refs` (`(...)`): green (the active ref is bolded separately by the tree styler)
 * - `spaceHeading` (`<spaceId>:`): bold
 * - `summary`: dim
 * - `emptyState`: dim
 */
export function createAnsiMigrationListStyler(opts: {
  readonly useColor: boolean;
}): MigrationListStylerWithMarkers {
  if (!opts.useColor) {
    return {
      ...IDENTITY_MIGRATION_LIST_STYLER,
      markers: plainMarkers,
    };
  }
  return {
    // Kind glyphs stay bright in both flat and graph views; lanes carry the dim gutter.
    kind: (text) => text,
    dirName: (text) => bold(text),
    sourceHash: (text) => dim(cyan(text)),
    destHash: (text) => cyanBright(text),
    glyph: (text) => dim(text),
    lane: (text) => dim(text),
    invariants: (ids) => yellow(`{${ids.join(', ')}}`),
    markers: (names) => {
      const sigil = green('@');
      return names.map((name) => sigil + styleMarkerName(name)).join(' ');
    },
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
