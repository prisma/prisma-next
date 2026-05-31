import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { bold } from 'colorette';
import stringWidth from 'string-width';
import type {
  MigrationGraphGridModel,
  MigrationGraphGridRow,
  StructuralCell,
} from './migration-graph-layout';
import type { ClassifiedEdge } from './migration-graph-rows';
import {
  abbreviateContractHash,
  MIGRATION_LIST_FORWARD_EDGE_GLYPH,
  MIGRATION_LIST_HASH_WIDTH,
} from './migration-list-data-column';
import type { MigrationEdgeKind } from './migration-list-graph-topology';
import type { MigrationListStyler } from './migration-list-render';
import { createAnsiMigrationListStyler } from './migration-list-styler';

const LABEL_GAP = 2;

export interface RenderMigrationGraphTreeOptions {
  readonly refsByHash?: ReadonlyMap<string, readonly string[]>;
  readonly dbHash?: string;
  readonly contractHash?: string;
  readonly activeRefName?: string;
  readonly hashLength?: number;
  readonly colorize: boolean;
}

function arrowForEdgeKind(kind: MigrationEdgeKind): string {
  if (kind === 'rollback') return '↓';
  if (kind === 'self') return '⟲';
  return '↑';
}

function renderCellPair(cell: StructuralCell, style: MigrationListStyler): string {
  switch (cell.kind) {
    case 'node':
      if (cell.arcLand === true) return style.lane('○◂');
      if (cell.arcTee === true) return style.lane('○─');
      return '○ ';
    case 'vertical-pass':
      return style.lane('│ ');
    case 'edge-lane':
      return style.lane(cell.ownsLabel ? `│${arrowForEdgeKind(cell.edgeKind)}` : '│ ');
    case 'branch-tee':
      return style.lane('├─');
    case 'merge-tee':
      return style.lane('├─');
    case 'branch-corner':
      return style.lane('╮ ');
    case 'merge-corner':
      return style.lane('╯ ');
    case 'arc-branch-corner':
      return style.lane('╮ ');
    case 'arc-land-corner':
      return style.lane('╯ ');
    case 'arc-crossing':
      return style.lane('┼─');
    case 'arc-land-bridge':
      return style.lane('──');
    case 'horizontal-pass':
      return style.lane('──');
    case 'empty':
      return '  ';
  }
}

function renderConnectorRow(
  row: MigrationGraphGridRow,
  gridWidth: number,
  style: MigrationListStyler,
): string {
  const isMerge = row.kind === 'merge-connector';
  if (row.cells.length === gridWidth) {
    let seenTee = false;
    let out = '';
    for (const cell of row.cells) {
      switch (cell.kind) {
        case 'branch-tee':
          out += style.lane(seenTee ? '┬─' : '├─');
          seenTee = true;
          break;
        case 'merge-tee':
          out += style.lane(seenTee ? '┴─' : '├─');
          seenTee = true;
          break;
        case 'branch-corner':
          out += style.lane('╮ ');
          break;
        case 'merge-corner':
          out += style.lane('╯ ');
          break;
        case 'vertical-pass':
          out += style.lane('│ ');
          break;
        case 'horizontal-pass':
          out += style.lane('──');
          break;
        default:
          out += '  ';
      }
    }
    return out;
  }

  const start = row.startLane ?? 0;
  const end = row.endLane ?? start;
  let out = '';
  for (let column = 0; column < gridWidth; column++) {
    if (column < start || column > end) out += '  ';
    else if (column === start) out += style.lane('├─');
    else if (column === end) out += style.lane(isMerge ? '╯ ' : '╮ ');
    else out += style.lane(isMerge ? '┴─' : '┬─');
  }
  return out;
}

function abbreviateHash(hash: string, hashLength: number): string {
  if (hash === EMPTY_CONTRACT_HASH) {
    return '∅';
  }
  const abbreviated = abbreviateContractHash(hash);
  return hashLength === MIGRATION_LIST_HASH_WIDTH ? abbreviated : abbreviated.slice(0, hashLength);
}

const MIN_HASH_DATA_COLUMN = 25;

function overlayNamesForContract(
  contractHash: string,
  opts: RenderMigrationGraphTreeOptions,
): readonly string[] {
  const names: string[] = [];
  const userRefs = opts.refsByHash?.get(contractHash);
  if (userRefs) {
    names.push(...[...userRefs].sort((a, b) => a.localeCompare(b)));
  }
  if (opts.dbHash === contractHash) {
    names.push('db');
  }
  if (opts.contractHash === contractHash && contractHash !== EMPTY_CONTRACT_HASH) {
    names.push('contract');
  }
  return names;
}

function createTreeStyler(opts: RenderMigrationGraphTreeOptions): MigrationListStyler {
  const base = createAnsiMigrationListStyler({ useColor: opts.colorize });
  const activeRefName = opts.activeRefName;
  if (!opts.colorize || activeRefName === undefined) {
    return base;
  }
  return {
    ...base,
    refs: (names) => {
      const styledNames = names.map((name) => (name === activeRefName ? bold(name) : name));
      return base.refs(styledNames);
    },
  };
}

function formatEdgeHashColumn(
  edge: ClassifiedEdge,
  style: MigrationListStyler,
  hashLength: number,
): string {
  if (edge.kind === 'self') {
    const hash = abbreviateHash(edge.from, hashLength);
    return `${style.sourceHash(hash)} ${style.glyph(MIGRATION_LIST_FORWARD_EDGE_GLYPH)} ${style.destHash(hash)}`;
  }
  const source =
    edge.from === EMPTY_CONTRACT_HASH
      ? style.glyph('∅')
      : style.sourceHash(abbreviateHash(edge.from, hashLength));
  const arrow = style.glyph(MIGRATION_LIST_FORWARD_EDGE_GLYPH);
  const dest = style.destHash(abbreviateHash(edge.to, hashLength));
  return `${source} ${arrow} ${dest}`;
}

function padVisible(text: string, targetWidth: number): string {
  const padding = Math.max(0, targetWidth - stringWidth(text));
  return text + ' '.repeat(padding);
}

function gridWidthForModel(rows: readonly MigrationGraphGridRow[]): number {
  return rows.reduce(
    (max, row) =>
      row.kind === 'node' || row.kind === 'edge' ? Math.max(max, row.cells.length) : max,
    1,
  );
}

function maxDirNameLength(edges: readonly ClassifiedEdge[]): number {
  if (edges.length === 0) return 0;
  return Math.max(...edges.map((edge) => edge.dirName.length));
}

function rowDirNameWidth(labelColumn: number, maxDirNameLen: number, dirNameGap: number): number {
  // Reserve a gap past the longest dirName so the widest name keeps a column of
  // whitespace before its `hash → hash` data; without it, a dirName equal to
  // maxDirNameLen gets zero padding and collides with the source hash.
  return Math.max(maxDirNameLen + dirNameGap, MIN_HASH_DATA_COLUMN - labelColumn);
}

function gridUsesSkipRollbackArcs(rows: readonly MigrationGraphGridRow[]): boolean {
  return rows.some((row) =>
    row.cells.some(
      (cell) => cell.kind === 'edge-lane' && cell.adjacency === 'node-skipping-rollback',
    ),
  );
}

function edgeLabelColumn(
  row: MigrationGraphGridRow,
  gridWidth: number,
  wideLabelColumn: number | undefined,
): number {
  if (wideLabelColumn !== undefined) {
    return wideLabelColumn;
  }
  const laneIndex = row.laneIndex ?? 0;
  if (row.edge?.from === EMPTY_CONTRACT_HASH && laneIndex === 0) {
    return (laneIndex + 1) * 2 + LABEL_GAP;
  }
  const usesFullRowGutter = row.cells.some(
    (cell, index) => index > laneIndex && cell.kind === 'vertical-pass',
  );
  return usesFullRowGutter ? row.cells.length * 2 + LABEL_GAP : (laneIndex + 1) * 2 + LABEL_GAP;
}

function nodeHasArcDecoration(row: MigrationGraphGridRow): boolean {
  return row.cells.some(
    (cell) => cell.kind === 'node' && (cell.arcTee === true || cell.arcLand === true),
  );
}

export function renderMigrationGraphTree(
  model: MigrationGraphGridModel,
  opts: RenderMigrationGraphTreeOptions,
): string {
  const style = createTreeStyler(opts);
  const hashLength = opts.hashLength ?? MIGRATION_LIST_HASH_WIDTH;
  const gridWidth = gridWidthForModel(model.rows);
  const wideLabelColumn = gridUsesSkipRollbackArcs(model.rows) ? gridWidth * 2 + 4 : undefined;
  const dirNameGap = wideLabelColumn !== undefined ? 3 : LABEL_GAP;
  const allEdges = model.rows
    .filter(
      (row): row is MigrationGraphGridRow & { edge: ClassifiedEdge } =>
        row.kind === 'edge' && row.edge !== undefined,
    )
    .map((row) => row.edge);
  const maxDirNameLen = maxDirNameLength(allEdges);

  const lines: string[] = [];

  for (let rowIndex = 0; rowIndex < model.rows.length; rowIndex++) {
    const row = model.rows[rowIndex];
    if (row === undefined) continue;

    if (row.kind === 'component-separator') {
      lines.push('');
      continue;
    }

    if (row.kind === 'branch-connector' || row.kind === 'merge-connector') {
      lines.push(renderConnectorRow(row, gridWidth, style).replace(/\s+$/, ''));
      continue;
    }

    let gutter = row.cells.map((cell) => renderCellPair(cell, style)).join('');
    const prevRow = model.rows[rowIndex - 1];
    let laneSpan = row.cells.length;
    if (row.kind === 'node') {
      const contractHash = row.contractHash ?? EMPTY_CONTRACT_HASH;
      if (prevRow?.kind === 'merge-connector' || contractHash === EMPTY_CONTRACT_HASH) {
        laneSpan = 1;
      } else {
        laneSpan = row.cells.length;
      }
    }
    const labelColumn =
      row.kind === 'edge'
        ? edgeLabelColumn(row, gridWidth, wideLabelColumn)
        : wideLabelColumn !== undefined &&
            (nodeHasArcDecoration(row) || row.contractHash !== undefined)
          ? wideLabelColumn
          : laneSpan * 2 + LABEL_GAP;
    if (
      row.kind === 'edge' &&
      row.edge?.from === EMPTY_CONTRACT_HASH &&
      (row.laneIndex ?? 0) === 0
    ) {
      gutter = row.cells
        .slice(0, 1)
        .map((cell) => renderCellPair(cell, style))
        .join('');
    } else if (row.kind === 'node' && laneSpan < row.cells.length && !nodeHasArcDecoration(row)) {
      gutter = row.cells
        .slice(0, laneSpan)
        .map((cell) => renderCellPair(cell, style))
        .join('');
    } else if (gutter.length < laneSpan * 2) {
      gutter = gutter.padEnd(laneSpan * 2, ' ');
    }
    const dirNameWidth = rowDirNameWidth(labelColumn, maxDirNameLen, dirNameGap);
    const dataColumn = labelColumn + dirNameWidth;
    const gutterPad = padVisible(gutter, labelColumn);

    if (row.kind === 'node') {
      const contractHash = row.contractHash ?? EMPTY_CONTRACT_HASH;
      const hashText =
        contractHash === EMPTY_CONTRACT_HASH
          ? '∅'
          : style.sourceHash(abbreviateHash(contractHash, hashLength));
      const overlayNames = overlayNamesForContract(contractHash, opts);
      const overlayPad =
        overlayNames.length > 0
          ? ' '.repeat(Math.max(0, dataColumn - labelColumn - stringWidth(hashText)))
          : '';
      const overlay = overlayNames.length > 0 ? style.refs(overlayNames) : '';
      lines.push(`${gutterPad}${hashText}${overlayPad}${overlay}`.replace(/\s+$/, ''));
      continue;
    }

    const edge = row.edge;
    if (edge === undefined) continue;

    const dirNamePadding = ' '.repeat(Math.max(0, dirNameWidth - edge.dirName.length));
    const dirName = `${style.dirName(edge.dirName)}${dirNamePadding}`;
    const hashColumn = formatEdgeHashColumn(edge, style, hashLength);
    lines.push(`${gutterPad}${dirName}${hashColumn}`.replace(/\s+$/, ''));
  }

  return lines.join('\n');
}
