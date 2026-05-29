import type { EdgeKind } from '@prisma-next/migration-tools/migration-list-graph-topology';
import type {
  MigrationListEntry,
  MigrationListResult,
} from '@prisma-next/migration-tools/migration-list-types';
import {
  computeMigrationDirNameWidth,
  formatMigrationDataColumn,
  MIGRATION_LIST_FORWARD_EDGE_GLYPH,
} from './migration-list-data-column';

export type { EdgeKind } from '@prisma-next/migration-tools/migration-list-graph-topology';

export type {
  MigrationListEntry,
  MigrationListResult,
  MigrationSpaceListEntry,
} from '@prisma-next/migration-tools/migration-list-types';

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

function resolveEdgeKind(
  migrationHash: string,
  kindByMigrationHash: ReadonlyMap<string, EdgeKind>,
): EdgeKind {
  return kindByMigrationHash.get(migrationHash) ?? 'forward';
}

function formatMigrationRow(
  migration: MigrationListEntry,
  dirNameWidth: number,
  edgeKind: EdgeKind,
  style: MigrationListStyler,
): string {
  const kindColumn = `${style.kind(KIND_GLYPH[edgeKind])} `;
  const data = formatMigrationDataColumn(migration, {
    dirNameWidth,
    edgeKind,
    style,
    forwardArrow: MIGRATION_LIST_FORWARD_EDGE_GLYPH,
  });
  return `${kindColumn}${data}`;
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

  const dirNameWidth = computeMigrationDirNameWidth(migrations);
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
