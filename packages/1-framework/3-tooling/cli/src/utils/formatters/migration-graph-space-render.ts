import type { MigrationGraph } from '@prisma-next/migration-tools/graph';
import type { GlyphMode } from '../glyph-mode';
import { buildMigrationGraphLayout } from './migration-graph-layout';
import { buildMigrationGraphRows } from './migration-graph-rows';
import {
  type MigrationEdgeAnnotation,
  renderMigrationGraphTree,
} from './migration-graph-tree-render';
import {
  buildEdgeAnnotationsByHashFromListEntries,
  buildRefsByHashFromListEntries,
  type MigrationListStyler,
} from './migration-list-render';
import type { MigrationListEntry } from './migration-list-types';

export { buildEdgeAnnotationsByHashFromListEntries } from './migration-list-render';

export function mergeMigrationEdgeAnnotations(
  listOverlay: ReadonlyMap<string, MigrationEdgeAnnotation>,
  statusOverlay: ReadonlyMap<string, MigrationEdgeAnnotation>,
): ReadonlyMap<string, MigrationEdgeAnnotation> {
  const merged = new Map<string, MigrationEdgeAnnotation>();
  for (const [migrationHash, listAnnotation] of listOverlay) {
    const statusAnnotation = statusOverlay.get(migrationHash);
    merged.set(migrationHash, {
      ...listAnnotation,
      ...(statusAnnotation?.status !== undefined ? { status: statusAnnotation.status } : {}),
    });
  }
  return merged;
}

export interface RenderMigrationGraphSpaceTreeInput {
  readonly graph: MigrationGraph;
  readonly migrations: readonly MigrationListEntry[];
  readonly liveContractHash: string;
  readonly glyphMode: GlyphMode;
  readonly colorize: boolean;
  readonly refsByHash?: ReadonlyMap<string, readonly string[]>;
  readonly statusOverlayByHash?: ReadonlyMap<string, MigrationEdgeAnnotation>;
  readonly dbHash?: string;
  readonly styler?: MigrationListStyler;
}

export function renderMigrationGraphSpaceTree(input: RenderMigrationGraphSpaceTreeInput): string {
  const rowModel = buildMigrationGraphRows(input.graph, {
    contractHash: input.liveContractHash,
  });
  const layout = buildMigrationGraphLayout(rowModel);
  const listOverlay = buildEdgeAnnotationsByHashFromListEntries(input.migrations);
  const edgeAnnotationsByHash =
    input.statusOverlayByHash === undefined
      ? listOverlay
      : mergeMigrationEdgeAnnotations(listOverlay, input.statusOverlayByHash);
  return renderMigrationGraphTree(layout, {
    refsByHash: input.refsByHash ?? buildRefsByHashFromListEntries(input.migrations),
    contractHash: input.liveContractHash,
    edgeAnnotationsByHash,
    colorize: input.colorize,
    glyphMode: input.glyphMode,
    ...(input.dbHash !== undefined ? { dbHash: input.dbHash } : {}),
    ...(input.styler !== undefined ? { styler: input.styler } : {}),
  });
}

export function indentMigrationGraphTreeBlock(treeOutput: string, indent: string): string {
  if (treeOutput.length === 0) {
    return treeOutput;
  }
  return treeOutput
    .split('\n')
    .map((line) => (line.length === 0 ? line : `${indent}${line}`))
    .join('\n');
}
