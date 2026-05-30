import {
  classifyMigrationListGraphTopology,
  type MigrationEdgeKind,
  type MigrationListGraphTopology,
} from '@prisma-next/migration-tools/migration-list-graph-topology';
import type {
  MigrationListEntry,
  MigrationListResult,
} from '@prisma-next/migration-tools/migration-list-types';
import type { GlyphMode } from '../glyph-mode';
import {
  computeMigrationDirNameWidth,
  formatMigrationDataColumn,
  migrationListEmptySource,
  migrationListForwardArrow,
  migrationListKindGlyph,
} from './migration-list-data-column';

export type { MigrationEdgeKind } from '@prisma-next/migration-tools/migration-list-graph-topology';
export type {
  MigrationListEntry,
  MigrationListResult,
  MigrationSpaceListEntry,
} from '@prisma-next/migration-tools/migration-list-types';
export type { GlyphMode } from '../glyph-mode';

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
  lane(text: string): string;
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
  lane: (text) => text,
  invariants: (ids) => `{${ids.join(', ')}}`,
  refs: (names) => `(${names.join(', ')})`,
  spaceHeading: (text) => text,
  summary: (text) => text,
  emptyState: (text) => text,
};

function resolveEdgeKind(
  migrationHash: string,
  kindByMigrationHash: ReadonlyMap<string, MigrationEdgeKind>,
): MigrationEdgeKind {
  return kindByMigrationHash.get(migrationHash) ?? 'forward';
}

function formatMigrationRow(
  migration: MigrationListEntry,
  dirNameWidth: number,
  edgeKind: MigrationEdgeKind,
  glyphMode: GlyphMode,
  style: MigrationListStyler,
): string {
  const kindColumn = `${style.kind(migrationListKindGlyph(glyphMode, edgeKind))} `;
  const data = formatMigrationDataColumn(migration, {
    dirNameWidth,
    edgeKind,
    style,
    forwardArrow: migrationListForwardArrow(glyphMode),
    emptySource: migrationListEmptySource(glyphMode),
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
  glyphMode: GlyphMode,
  kindByMigrationHash: ReadonlyMap<string, MigrationEdgeKind>,
  style: MigrationListStyler,
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
      glyphMode,
      style,
    ),
  );
  if (!multiSpace) {
    return rows;
  }
  return [style.spaceHeading(`${spaceId}:`), ...rows.map((row) => `  ${row}`)];
}

export function buildMigrationListTopologyBySpace(
  result: MigrationListResult,
): ReadonlyMap<string, MigrationListGraphTopology> {
  const topologyBySpaceId = new Map<string, MigrationListGraphTopology>();
  for (const space of result.spaces) {
    topologyBySpaceId.set(space.spaceId, classifyMigrationListGraphTopology(space.migrations));
  }
  return topologyBySpaceId;
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
  glyphMode: GlyphMode = 'unicode',
  topologyBySpaceId: ReadonlyMap<
    string,
    MigrationListGraphTopology
  > = buildMigrationListTopologyBySpace(result),
): string {
  const multiSpace = result.spaces.length > 1;
  const lines: string[] = [];

  for (let index = 0; index < result.spaces.length; index++) {
    const space = result.spaces[index]!;
    if (index > 0) {
      lines.push('');
    }
    const topology = topologyBySpaceId.get(space.spaceId);
    const kindByMigrationHash =
      topology?.kindByMigrationHash ??
      classifyMigrationListGraphTopology(space.migrations).kindByMigrationHash;
    lines.push(
      ...renderSpaceBlock(
        space.spaceId,
        space.migrations,
        multiSpace,
        glyphMode,
        kindByMigrationHash,
        style,
      ),
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

export function renderMigrationList(result: MigrationListResult): string {
  return renderMigrationListWithStyle(result, IDENTITY_MIGRATION_LIST_STYLER);
}
