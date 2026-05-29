import type { EdgeKind } from '@prisma-next/migration-tools/migration-list-graph-topology';
import type {
  MigrationListEntry,
  MigrationListResult,
} from '@prisma-next/migration-tools/migration-list-types';

export type { EdgeKind } from '@prisma-next/migration-tools/migration-list-graph-topology';

export type {
  MigrationListEntry,
  MigrationListResult,
  MigrationSpaceListEntry,
} from '@prisma-next/migration-tools/migration-list-types';

const HASH_WIDTH = 7;
const EMPTY_SOURCE = '∅';
const FORWARD_EDGE_GLYPH = '→';
const DECORATION_PREFIX = '  ';

const KIND_GLYPH: Record<EdgeKind, string> = {
  forward: '*',
  rollback: '↩',
  self: '⟲',
};

/**
 * Semantic styler for `migration list` output tokens. Token-typed so
 * the renderer composes presentation-neutral fragments and the styler
 * decides how each token kind is decorated (ANSI codes, plain text,
 * etc.). The renderer pads with raw spaces *outside* styled tokens so
 * visible column widths stay stable regardless of what the styler
 * emits — adding ANSI escape sequences never disturbs alignment.
 *
 * `invariants` and `refs` receive the underlying string arrays rather
 * than a pre-joined string so per-element styling (e.g. distinguishing
 * the live-DB `db` marker from user-named refs) is possible without
 * having to re-parse a joined block.
 */
export interface MigrationListStyler {
  kind(text: string): string;
  dirName(text: string): string;
  sourceHash(text: string): string;
  destHash(text: string): string;
  glyph(text: string): string;
  invariants(ids: readonly string[]): string;
  refs(names: readonly string[]): string;
  spaceHeading(text: string): string;
  summary(text: string): string;
  emptyState(text: string): string;
}

export const IDENTITY_MIGRATION_LIST_STYLER: MigrationListStyler = {
  kind: (text) => text,
  dirName: (text) => text,
  sourceHash: (text) => text,
  destHash: (text) => text,
  glyph: (text) => text,
  invariants: (ids) => `{${ids.join(', ')}}`,
  refs: (names) => `(${names.join(', ')})`,
  spaceHeading: (text) => text,
  summary: (text) => text,
  emptyState: (text) => text,
};

function abbreviateContractHash(hash: string): string {
  const stripped = hash.startsWith('sha256:') ? hash.slice(7) : hash;
  return stripped.slice(0, HASH_WIDTH);
}

function formatSourceColumn(from: string | null, style: MigrationListStyler): string {
  if (from === null) {
    return style.glyph(EMPTY_SOURCE) + ' '.repeat(HASH_WIDTH - EMPTY_SOURCE.length);
  }
  return style.sourceHash(abbreviateContractHash(from));
}

function resolveEdgeKind(
  migrationHash: string,
  kindByMigrationHash: ReadonlyMap<string, EdgeKind>,
): EdgeKind {
  return kindByMigrationHash.get(migrationHash) ?? 'forward';
}

function formatDecorations(
  providedInvariants: readonly string[],
  refs: readonly string[],
  style: MigrationListStyler,
): string {
  const blocks: string[] = [];
  if (providedInvariants.length > 0) {
    blocks.push(style.invariants(providedInvariants));
  }
  if (refs.length > 0) {
    blocks.push(style.refs(refs));
  }
  if (blocks.length === 0) return '';
  return `${DECORATION_PREFIX}${blocks.join(' ')}`;
}

function formatMigrationRow(
  migration: MigrationListEntry,
  dirNameWidth: number,
  edgeKind: EdgeKind,
  style: MigrationListStyler,
): string {
  const kindColumn = `${style.kind(KIND_GLYPH[edgeKind])} `;
  const dirNamePadding = ' '.repeat(Math.max(0, dirNameWidth - migration.dirName.length));
  const dirName = `${style.dirName(migration.dirName)}${dirNamePadding}`;
  const decorations = formatDecorations(migration.providedInvariants, migration.refs, style);

  if (edgeKind === 'self') {
    const contractHash = migration.from ?? migration.to;
    const hash = style.sourceHash(abbreviateContractHash(contractHash));
    return `${kindColumn}${dirName}  ${hash}${decorations}`;
  }

  const source = formatSourceColumn(migration.from, style);
  const arrow = style.glyph(FORWARD_EDGE_GLYPH);
  const dest = style.destHash(abbreviateContractHash(migration.to));
  return `${kindColumn}${dirName}${source} ${arrow} ${dest}${decorations}`;
}

function formatEmptyStateLine(spaceId: string, style: MigrationListStyler): string {
  return style.emptyState(`There are no migrations in migrations/${spaceId}/ yet`);
}

function renderSpaceBlock(
  spaceId: string,
  migrations: readonly MigrationListEntry[],
  multiSpace: boolean,
  style: MigrationListStyler,
  kindByMigrationHash: ReadonlyMap<string, EdgeKind>,
): readonly string[] {
  if (migrations.length === 0) {
    const emptyLine = formatEmptyStateLine(spaceId, style);
    if (!multiSpace) {
      return [emptyLine];
    }
    return [style.spaceHeading(`${spaceId}:`), `  ${emptyLine}`];
  }

  const dirNameWidth = Math.max(...migrations.map((entry) => entry.dirName.length)) + 2;
  const rows = migrations.map((entry) =>
    formatMigrationRow(
      entry,
      dirNameWidth,
      resolveEdgeKind(entry.migrationHash, kindByMigrationHash),
      style,
    ),
  );
  if (!multiSpace) {
    return rows;
  }
  return [style.spaceHeading(`${spaceId}:`), ...rows.map((row) => `  ${row}`)];
}

/**
 * Compose the styled `migration list` output. The renderer is
 * presentation-neutral — every token passes through `style` before
 * landing in the output, so the same composition serves the pure-text
 * path ({@link renderMigrationList} via
 * {@link IDENTITY_MIGRATION_LIST_STYLER}) and the ANSI-styled CLI path
 * (via the ANSI styler the CLI shell wires up).
 */
export function renderMigrationListWithStyle(
  result: MigrationListResult,
  style: MigrationListStyler,
  kindByMigrationHash: ReadonlyMap<string, EdgeKind>,
): string {
  const multiSpace = result.spaces.length > 1;
  const lines: string[] = [];

  for (let index = 0; index < result.spaces.length; index++) {
    const space = result.spaces[index]!;
    if (index > 0) {
      lines.push('');
    }
    lines.push(
      ...renderSpaceBlock(space.spaceId, space.migrations, multiSpace, style, kindByMigrationHash),
    );
  }

  const totalMigrations = result.spaces.reduce(
    (count, space) => count + space.migrations.length,
    0,
  );
  if (totalMigrations > 0) {
    lines.push('');
    lines.push(style.summary(result.summary));
  }

  return lines.join('\n');
}

export function renderMigrationList(
  result: MigrationListResult,
  kindByMigrationHash: ReadonlyMap<string, EdgeKind>,
): string {
  return renderMigrationListWithStyle(result, IDENTITY_MIGRATION_LIST_STYLER, kindByMigrationHash);
}
