import type { MigrationGraph } from '@prisma-next/migration-tools/graph';
import type { GlyphMode } from '../glyph-mode';
import { buildMigrationGraphLayout } from './migration-graph-layout';
import { buildMigrationGraphRows } from './migration-graph-rows';
import {
  computeMaxDirNameLengthForLayout,
  computeMaxEdgeTreePrefixWidthForLayout,
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
  readonly globalMaxEdgeTreePrefixWidth?: number;
  readonly globalMaxDirNameWidth?: number;
  /**
   * Whether this render is for the app space. When false, `contractHash` is
   * not forwarded to `buildMigrationGraphRows` (suppressing the floating
   * working-contract node) and `isAppSpace: false` is passed to
   * `renderMigrationGraphTree` (suppressing the `@contract` marker).
   * Defaults to `true` so single-space callers are unaffected.
   */
  readonly isAppSpace?: boolean;
}

export interface ComputeGlobalMaxEdgeTreePrefixWidthInput {
  readonly graph: MigrationGraph;
  readonly liveContractHash: string;
}

export function computeGlobalMaxEdgeTreePrefixWidth(
  inputs: readonly ComputeGlobalMaxEdgeTreePrefixWidthInput[],
): number {
  let globalMax = 0;
  for (const input of inputs) {
    const rowModel = buildMigrationGraphRows(input.graph, {
      contractHash: input.liveContractHash,
    });
    const layout = buildMigrationGraphLayout(rowModel);
    globalMax = Math.max(globalMax, computeMaxEdgeTreePrefixWidthForLayout(layout));
  }
  return globalMax;
}

export function computeGlobalMaxDirNameWidth(
  inputs: readonly ComputeGlobalMaxEdgeTreePrefixWidthInput[],
): number {
  let globalMax = 0;
  for (const input of inputs) {
    const rowModel = buildMigrationGraphRows(input.graph, {
      contractHash: input.liveContractHash,
    });
    const layout = buildMigrationGraphLayout(rowModel);
    globalMax = Math.max(globalMax, computeMaxDirNameLengthForLayout(layout));
  }
  return globalMax;
}

function renderMigrationGraphSpaceTreeInternal(input: RenderMigrationGraphSpaceTreeInput): string {
  const appSpace = input.isAppSpace !== false;
  const rowModel = buildMigrationGraphRows(input.graph, {
    ...(appSpace ? { contractHash: input.liveContractHash } : {}),
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
    isAppSpace: appSpace,
    edgeAnnotationsByHash,
    colorize: input.colorize,
    glyphMode: input.glyphMode,
    ...(input.dbHash !== undefined ? { dbHash: input.dbHash } : {}),
    ...(input.styler !== undefined ? { styler: input.styler } : {}),
    ...(input.globalMaxEdgeTreePrefixWidth !== undefined
      ? { globalMaxEdgeTreePrefixWidth: input.globalMaxEdgeTreePrefixWidth }
      : {}),
    ...(input.globalMaxDirNameWidth !== undefined
      ? { globalMaxDirNameWidth: input.globalMaxDirNameWidth }
      : {}),
  });
}

export function renderMigrationGraphSpaceTree(input: RenderMigrationGraphSpaceTreeInput): string {
  return renderMigrationGraphSpaceTreeInternal(input);
}

export function renderMigrationGraphSpaceTrees(
  inputs: readonly RenderMigrationGraphSpaceTreeInput[],
): readonly string[] {
  const globalMaxTreePrefix =
    inputs.length > 1 ? computeGlobalMaxEdgeTreePrefixWidth(inputs) : undefined;
  const globalMaxDirName = inputs.length > 1 ? computeGlobalMaxDirNameWidth(inputs) : undefined;
  return inputs.map((input) =>
    renderMigrationGraphSpaceTreeInternal({
      ...input,
      ...(globalMaxTreePrefix !== undefined
        ? { globalMaxEdgeTreePrefixWidth: globalMaxTreePrefix }
        : {}),
      ...(globalMaxDirName !== undefined ? { globalMaxDirNameWidth: globalMaxDirName } : {}),
    }),
  );
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
