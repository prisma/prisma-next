import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { MigrationEdge, MigrationGraph } from '@prisma-next/migration-tools/graph';
import type { GlyphMode } from '../glyph-mode';
import { buildMigrationGraphLayout } from './migration-graph-layout';
import { buildMigrationGraphRows } from './migration-graph-rows';
import {
  type MigrationEdgeAnnotation,
  renderMigrationGraphTree,
} from './migration-graph-tree-render';
import type { MigrationListEntry, MigrationListResult } from './migration-list-types';

export type { GlyphMode } from '../glyph-mode';
export type { MigrationEdgeKind } from './migration-list-graph-topology';
export type {
  MigrationListEntry,
  MigrationListResult,
  MigrationSpaceListEntry,
} from './migration-list-types';

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

function canonicalFrom(from: string | null): string {
  return from ?? EMPTY_CONTRACT_HASH;
}

export function migrationGraphFromListEntries(
  entries: readonly MigrationListEntry[],
): MigrationGraph {
  const nodes = new Set<string>();
  const forwardChain = new Map<string, MigrationEdge[]>();
  const reverseChain = new Map<string, MigrationEdge[]>();
  const migrationByHash = new Map<string, MigrationEdge>();

  for (const entry of entries) {
    const from = canonicalFrom(entry.from);
    const edge: MigrationEdge = {
      from,
      to: entry.to,
      migrationHash: entry.migrationHash,
      dirName: entry.dirName,
      createdAt: entry.createdAt,
      invariants: entry.providedInvariants,
    };
    nodes.add(from);
    nodes.add(entry.to);
    const forward = forwardChain.get(from);
    if (forward) forward.push(edge);
    else forwardChain.set(from, [edge]);
    const reverse = reverseChain.get(entry.to);
    if (reverse) reverse.push(edge);
    else reverseChain.set(entry.to, [edge]);
    migrationByHash.set(entry.migrationHash, edge);
  }

  return { nodes, forwardChain, reverseChain, migrationByHash };
}

export function buildEdgeAnnotationsByHashFromListEntries(
  entries: readonly MigrationListEntry[],
): ReadonlyMap<string, MigrationEdgeAnnotation> {
  const annotations = new Map<string, MigrationEdgeAnnotation>();
  for (const entry of entries) {
    annotations.set(entry.migrationHash, {
      operationCount: entry.operationCount,
      invariants: entry.providedInvariants,
    });
  }
  return annotations;
}

export function buildRefsByHashFromListEntries(
  entries: readonly MigrationListEntry[],
): ReadonlyMap<string, readonly string[]> {
  const refsByHash = new Map<string, readonly string[]>();
  for (const entry of entries) {
    if (entry.refs.length > 0) {
      refsByHash.set(entry.to, entry.refs);
    }
  }
  return refsByHash;
}

function formatEmptyStateLine(spaceId: string, style: MigrationListStyler): string {
  return style.emptyState(`There are no migrations in migrations/${spaceId}/ yet`);
}

function indentTreeBlock(treeOutput: string, indent: string): string {
  if (treeOutput.length === 0) {
    return treeOutput;
  }
  return treeOutput
    .split('\n')
    .map((line) => (line.length === 0 ? line : `${indent}${line}`))
    .join('\n');
}

function renderSpaceTreeBlock(
  spaceId: string,
  migrations: readonly MigrationListEntry[],
  multiSpace: boolean,
  glyphMode: GlyphMode,
  style: MigrationListStyler,
  colorize: boolean,
): readonly string[] {
  if (migrations.length === 0) {
    const emptyLine = formatEmptyStateLine(spaceId, style);
    if (!multiSpace) {
      return [emptyLine];
    }
    return [style.spaceHeading(`${spaceId}:`), `  ${emptyLine}`];
  }

  const graph = migrationGraphFromListEntries(migrations);
  const rowModel = buildMigrationGraphRows(graph);
  const layout = buildMigrationGraphLayout(rowModel);
  const treeOutput = renderMigrationGraphTree(layout, {
    refsByHash: buildRefsByHashFromListEntries(migrations),
    edgeAnnotationsByHash: buildEdgeAnnotationsByHashFromListEntries(migrations),
    colorize,
    glyphMode,
  });

  if (!multiSpace) {
    return treeOutput.length === 0 ? [] : [treeOutput];
  }

  const indented = indentTreeBlock(treeOutput, '  ');
  return [style.spaceHeading(`${spaceId}:`), indented];
}

export interface RenderMigrationListWithStyleOptions {
  readonly colorize?: boolean;
}

/**
 * Compose the styled `migration list` human output via the shared tree
 * renderer. Each on-disk migration is one edge row with package-fact
 * annotations; refs decorate destination contract nodes.
 *
 * `options.colorize` must match whether `style` emits ANSI (e.g. both true for
 * `createAnsiMigrationListStyler({ useColor: true })`).
 */
export function renderMigrationListWithStyle(
  result: MigrationListResult,
  style: MigrationListStyler,
  glyphMode: GlyphMode = 'unicode',
  options: RenderMigrationListWithStyleOptions = {},
): string {
  const multiSpace = result.spaces.length > 1;
  const colorize = options.colorize ?? false;
  const lines: string[] = [];

  for (let index = 0; index < result.spaces.length; index++) {
    const space = result.spaces[index]!;
    if (index > 0) {
      lines.push('');
    }
    lines.push(
      ...renderSpaceTreeBlock(
        space.spaceId,
        space.migrations,
        multiSpace,
        glyphMode,
        style,
        colorize,
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
