import type { MigrationEdgeKind } from '@prisma-next/migration-tools/migration-list-graph-topology';
import type { MigrationListEntry } from '@prisma-next/migration-tools/migration-list-types';
import type { GlyphMode } from '../glyph-mode';
import type { MigrationListStyler } from './migration-list-render';

export const MIGRATION_LIST_HASH_WIDTH = 7;
export const MIGRATION_LIST_EMPTY_SOURCE = '∅';
export const MIGRATION_LIST_ASCII_EMPTY_SOURCE = '-';
export const MIGRATION_LIST_FORWARD_EDGE_GLYPH = '→';
export const MIGRATION_LIST_ASCII_FORWARD_EDGE_GLYPH = '->';
export const MIGRATION_LIST_DECORATION_PREFIX = '  ';

export const MIGRATION_LIST_UNICODE_KIND_GLYPH: Record<MigrationEdgeKind, string> = {
  forward: '*',
  rollback: '↩',
  self: '⟲',
};

export const MIGRATION_LIST_ASCII_KIND_GLYPH: Record<MigrationEdgeKind, string> = {
  forward: '*',
  rollback: '<',
  self: '~',
};

export function migrationListKindGlyph(glyphMode: GlyphMode, edgeKind: MigrationEdgeKind): string {
  return glyphMode === 'ascii'
    ? MIGRATION_LIST_ASCII_KIND_GLYPH[edgeKind]
    : MIGRATION_LIST_UNICODE_KIND_GLYPH[edgeKind];
}

export function migrationListForwardArrow(glyphMode: GlyphMode): string {
  return glyphMode === 'ascii'
    ? MIGRATION_LIST_ASCII_FORWARD_EDGE_GLYPH
    : MIGRATION_LIST_FORWARD_EDGE_GLYPH;
}

export function migrationListEmptySource(glyphMode: GlyphMode): string {
  return glyphMode === 'ascii' ? MIGRATION_LIST_ASCII_EMPTY_SOURCE : MIGRATION_LIST_EMPTY_SOURCE;
}

export function abbreviateContractHash(hash: string): string {
  const stripped = hash.startsWith('sha256:') ? hash.slice(7) : hash;
  return stripped.slice(0, MIGRATION_LIST_HASH_WIDTH);
}

export function computeMigrationDirNameWidth(migrations: readonly MigrationListEntry[]): number {
  if (migrations.length === 0) return 0;
  return Math.max(...migrations.map((entry) => entry.dirName.length)) + 2;
}

function formatSourceColumn(
  from: string | null,
  style: MigrationListStyler,
  emptySource: string,
): string {
  if (from === null) {
    return style.glyph(emptySource) + ' '.repeat(MIGRATION_LIST_HASH_WIDTH - emptySource.length);
  }
  return style.sourceHash(abbreviateContractHash(from));
}

export function formatDecorations(
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
  return `${MIGRATION_LIST_DECORATION_PREFIX}${blocks.join(' ')}`;
}

export interface MigrationDataColumnOptions {
  readonly dirNameWidth: number;
  readonly edgeKind: MigrationEdgeKind;
  readonly style: MigrationListStyler;
  readonly forwardArrow?: string;
  readonly emptySource?: string;
}

export function formatMigrationDataColumn(
  migration: MigrationListEntry,
  options: MigrationDataColumnOptions,
): string {
  const {
    dirNameWidth,
    edgeKind,
    style,
    forwardArrow = MIGRATION_LIST_FORWARD_EDGE_GLYPH,
    emptySource = MIGRATION_LIST_EMPTY_SOURCE,
  } = options;
  const dirNamePadding = ' '.repeat(Math.max(0, dirNameWidth - migration.dirName.length));
  const dirName = `${style.dirName(migration.dirName)}${dirNamePadding}`;
  const decorations = formatDecorations(migration.providedInvariants, migration.refs, style);

  if (edgeKind === 'self') {
    const contractHash = migration.from ?? migration.to;
    const hash = style.sourceHash(abbreviateContractHash(contractHash));
    return `${dirName}${hash}${decorations}`;
  }

  const source = formatSourceColumn(migration.from, style, emptySource);
  const arrow = style.glyph(forwardArrow);
  const dest = style.destHash(abbreviateContractHash(migration.to));
  return `${dirName}${source} ${arrow} ${dest}${decorations}`;
}

export function formatNodeLineDataColumn(contractHash: string, style: MigrationListStyler): string {
  return style.sourceHash(abbreviateContractHash(contractHash));
}
