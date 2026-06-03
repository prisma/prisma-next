import type { GlyphMode } from '../glyph-mode';

export const MIGRATION_LIST_HASH_WIDTH = 7;
export const MIGRATION_LIST_EMPTY_SOURCE = '∅';
export const MIGRATION_LIST_ASCII_EMPTY_SOURCE = '-';
export const MIGRATION_LIST_FORWARD_EDGE_GLYPH = '→';
export const MIGRATION_LIST_ASCII_FORWARD_EDGE_GLYPH = '->';

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
